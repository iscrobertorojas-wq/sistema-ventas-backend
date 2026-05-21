import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { withAuth } from '@/lib/auth';

export const GET = withAuth(async function GET() {
    try {
        const query = `
            SELECT 
                l.*,
                c.name AS client_name,
                p.description AS product_description,
                p.price AS product_price,
                CASE 
                    WHEN l.is_renewed_current_year = 1 THEN 'Renovado'
                    WHEN l.expiration_date < CURRENT_DATE() THEN 'Vencido'
                    ELSE 'Vigente'
                END AS status
            FROM ContpaqiLicenses l
            JOIN Clients c ON l.client_id = c.id
            JOIN ContpaqiProducts p ON l.product_id = p.id
            ORDER BY l.expiration_date ASC
        `;
        const [rows] = await pool.query<RowDataPacket[]>(query);
        return NextResponse.json(rows);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const POST = withAuth(async function POST(request) {
    try {
        const body = await request.json();
        const {
            serial_number,
            client_id,
            product_id,
            users_count,
            expiration_date,
            contact_name,
            contact_phone,
            is_renewed_current_year
        } = body;

        if (!serial_number || !client_id || !product_id || !expiration_date || !contact_name || !contact_phone) {
            return NextResponse.json({ error: 'Faltan campos obligatorios' }, { status: 400 });
        }

        // Check if serial number already exists
        const [existing] = await pool.query<RowDataPacket[]>(
            'SELECT id FROM ContpaqiLicenses WHERE serial_number = ?',
            [serial_number]
        );
        if (existing.length > 0) {
            return NextResponse.json({ error: 'El número de serie de la licencia ya está registrado' }, { status: 409 });
        }

        const isRenewed = is_renewed_current_year ? 1 : 0;
        let renewalDate = null;
        let finalExpirationDate = new Date(expiration_date);

        if (isRenewed === 1) {
            renewalDate = body.renewal_date ? new Date(body.renewal_date) : new Date();
            finalExpirationDate.setFullYear(finalExpirationDate.getFullYear() + 1);
        }

        const [result] = await pool.query<ResultSetHeader>(
            `INSERT INTO ContpaqiLicenses 
            (serial_number, client_id, product_id, users_count, expiration_date, contact_name, contact_phone, is_renewed_current_year, renewal_date) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                serial_number,
                client_id,
                product_id,
                users_count || 1,
                finalExpirationDate,
                contact_name,
                contact_phone,
                isRenewed,
                renewalDate
            ]
        );

        return NextResponse.json({
            id: result.insertId,
            serial_number,
            client_id,
            product_id,
            users_count,
            expiration_date: finalExpirationDate,
            contact_name,
            contact_phone,
            is_renewed_current_year: isRenewed,
            renewal_date: renewalDate
        }, { status: 201 });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const PUT = withAuth(async function PUT(request) {
    try {
        const body = await request.json();
        const {
            id,
            serial_number,
            client_id,
            product_id,
            users_count,
            expiration_date,
            contact_name,
            contact_phone,
            is_renewed_current_year,
            toggleRenewal
        } = body;

        if (!id) {
            return NextResponse.json({ error: 'ID de la licencia es requerido' }, { status: 400 });
        }

        // Fetch existing license details
        const [existing] = await pool.query<RowDataPacket[]>(
            'SELECT * FROM ContpaqiLicenses WHERE id = ?',
            [id]
        );

        if (existing.length === 0) {
            return NextResponse.json({ error: 'Licencia no encontrada' }, { status: 404 });
        }

        const currentLicense = existing[0];

        // Case 1: Toggle renewal only (quick action from list)
        if (toggleRenewal) {
            const nextRenewed = currentLicense.is_renewed_current_year === 1 ? 0 : 1;
            const renewalDate = nextRenewed === 1 ? (body.renewalDate ? new Date(body.renewalDate) : new Date()) : null;
            
            // Adjust expiration date: add or subtract 1 year
            const currentExpDate = new Date(currentLicense.expiration_date);
            if (nextRenewed === 1) {
                currentExpDate.setFullYear(currentExpDate.getFullYear() + 1);
            } else {
                currentExpDate.setFullYear(currentExpDate.getFullYear() - 1);
            }

            await pool.query(
                `UPDATE ContpaqiLicenses 
                 SET is_renewed_current_year = ?, renewal_date = ?, expiration_date = ? 
                 WHERE id = ?`,
                [nextRenewed, renewalDate, currentExpDate, id]
            );

            return NextResponse.json({
                message: 'Renovación actualizada con éxito',
                is_renewed_current_year: nextRenewed,
                renewal_date: renewalDate,
                expiration_date: currentExpDate
            });
        }

        // Case 2: Full Edit Form Submission
        if (!serial_number || !client_id || !product_id || !expiration_date || !contact_name || !contact_phone) {
            return NextResponse.json({ error: 'Faltan campos obligatorios' }, { status: 400 });
        }

        // Check if serial number already exists for OTHER licenses
        const [serialCheck] = await pool.query<RowDataPacket[]>(
            'SELECT id FROM ContpaqiLicenses WHERE serial_number = ? AND id != ?',
            [serial_number, id]
        );
        if (serialCheck.length > 0) {
            return NextResponse.json({ error: 'El número de serie de la licencia ya está registrado por otra licencia' }, { status: 409 });
        }

        // Lógica de cálculo de renovación si cambia
        const prevRenewed = currentLicense.is_renewed_current_year;
        const nextRenewed = is_renewed_current_year ? 1 : 0;
        let renewalDate = currentLicense.renewal_date;
        let finalExpirationDate = new Date(expiration_date);

        if (prevRenewed === 0 && nextRenewed === 1) {
            // Se acaba de renovar: sumamos 1 año y ponemos la fecha hoy o la provista
            renewalDate = body.renewal_date ? new Date(body.renewal_date) : new Date();
            finalExpirationDate.setFullYear(finalExpirationDate.getFullYear() + 1);
        } else if (prevRenewed === 1 && nextRenewed === 0) {
            // Se desmarcó la renovación: restamos 1 año y limpiamos fecha
            renewalDate = null;
            finalExpirationDate.setFullYear(finalExpirationDate.getFullYear() - 1);
        } else if (nextRenewed === 1 && body.renewal_date) {
            // Si ya estaba renovado pero actualizaron la fecha de renovación
            renewalDate = new Date(body.renewal_date);
        }

        await pool.query(
            `UPDATE ContpaqiLicenses SET 
                serial_number = ?, 
                client_id = ?, 
                product_id = ?, 
                users_count = ?, 
                expiration_date = ?, 
                contact_name = ?, 
                contact_phone = ?, 
                is_renewed_current_year = ?, 
                renewal_date = ?
            WHERE id = ?`,
            [
                serial_number,
                client_id,
                product_id,
                users_count || 1,
                finalExpirationDate,
                contact_name,
                contact_phone,
                nextRenewed,
                renewalDate,
                id
            ]
        );

        return NextResponse.json({
            id,
            serial_number,
            client_id,
            product_id,
            users_count,
            expiration_date: finalExpirationDate,
            contact_name,
            contact_phone,
            is_renewed_current_year: nextRenewed,
            renewal_date: renewalDate
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const DELETE = withAuth(async function DELETE(request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'ID es requerido' }, { status: 400 });
        }

        await pool.query('DELETE FROM ContpaqiLicenses WHERE id = ?', [id]);

        return NextResponse.json({ message: 'Licencia de Contpaqi eliminada correctamente' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
