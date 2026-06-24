import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { withAuth } from '@/lib/auth';

export const GET = withAuth(async function GET(request: Request) {
    try {
        const query = `
            SELECT 
                q.id,
                q.folio,
                q.date,
                q.iva_mode,
                q.currency,
                q.subtotal,
                q.iva,
                q.total,
                q.observations,
                c.id as client_id,
                c.name as client_name,
                c.phone as client_phone,
                (
                    SELECT GROUP_CONCAT(qi.description SEPARATOR ', ')
                    FROM QuotationItems qi
                    WHERE qi.quotation_id = q.id
                ) as items_summary
            FROM Quotations q
            JOIN Clients c ON q.client_id = c.id
            ORDER BY q.date DESC
        `;

        const [rows] = await pool.query<RowDataPacket[]>(query);
        return NextResponse.json(rows);
    } catch (error: any) {
        console.error('Error fetching quotations:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const POST = withAuth(async function POST(request: Request) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const body = await request.json();
        const { client_id, items, date, iva_mode, currency, observations } = body;

        if (!client_id || !items || items.length === 0) {
            return NextResponse.json({ error: 'Client and items are required' }, { status: 400 });
        }

        // Calculate subtotal from items
        const subtotal = items.reduce((sum: number, item: any) => {
            const lineAmount = parseFloat(item.unit_price) * (item.quantity || 1) * (1 - (parseFloat(item.discount_percent || 0) / 100));
            return sum + lineAmount;
        }, 0);

        // Calculate IVA based on mode
        let iva = 0;
        let total = subtotal;

        if (iva_mode === 'add') {
            // Add 16% on top
            iva = subtotal * 0.16;
            total = subtotal + iva;
        } else if (iva_mode === 'breakdown') {
            // Prices already include IVA, break it down
            total = subtotal;
            iva = subtotal - (subtotal / 1.16);
        }

        // Get current folio
        const [settings] = await connection.query<RowDataPacket[]>(
            'SELECT setting_value FROM Settings WHERE setting_key = ?',
            ['folio_quotation']
        );

        let currentFolio = 1;
        if (settings.length > 0) {
            currentFolio = parseInt(settings[0].setting_value);
        }

        const folio = `C-${currentFolio}`;
        const quotationDate = date ? new Date(date) : new Date();

        // Insert Quotation
        const [result] = await connection.query<ResultSetHeader>(
            'INSERT INTO Quotations (folio, client_id, date, iva_mode, currency, subtotal, iva, total, observations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [folio, client_id, quotationDate, iva_mode || 'none', currency || 'MXN', subtotal, iva, total, observations || null]
        );
        const quotationId = result.insertId;

        // Insert Items
        for (const item of items) {
            const lineAmount = parseFloat(item.unit_price) * (item.quantity || 1) * (1 - (parseFloat(item.discount_percent || 0) / 100));
            await connection.query(
                'INSERT INTO QuotationItems (quotation_id, description, unit_price, quantity, discount_percent, amount) VALUES (?, ?, ?, ?, ?, ?)',
                [quotationId, item.description, item.unit_price, item.quantity || 1, item.discount_percent || 0, lineAmount]
            );
        }

        // Increment folio counter
        const nextFolio = currentFolio + 1;
        await connection.query(
            'INSERT INTO Settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            ['folio_quotation', nextFolio.toString(), nextFolio.toString()]
        );

        await connection.commit();
        return NextResponse.json({ id: quotationId, folio, message: 'Quotation created successfully' }, { status: 201 });
    } catch (error: any) {
        await connection.rollback();
        console.error('Error creating quotation:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        connection.release();
    }
});

export const PUT = withAuth(async function PUT(request: Request) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const body = await request.json();
        const { id, client_id, items, date, iva_mode, currency, observations } = body;

        if (!id || !client_id || !items || items.length === 0) {
            return NextResponse.json({ error: 'ID, Client and items are required' }, { status: 400 });
        }

        // Calculate subtotal from items
        const subtotal = items.reduce((sum: number, item: any) => {
            const lineAmount = parseFloat(item.unit_price) * (item.quantity || 1) * (1 - (parseFloat(item.discount_percent || 0) / 100));
            return sum + lineAmount;
        }, 0);

        let iva = 0;
        let total = subtotal;

        if (iva_mode === 'add') {
            iva = subtotal * 0.16;
            total = subtotal + iva;
        } else if (iva_mode === 'breakdown') {
            total = subtotal;
            iva = subtotal - (subtotal / 1.16);
        }

        const quotationDate = date ? new Date(date) : new Date();

        // Update Quotation
        await connection.query(
            'UPDATE Quotations SET client_id = ?, date = ?, iva_mode = ?, currency = ?, subtotal = ?, iva = ?, total = ?, observations = ? WHERE id = ?',
            [client_id, quotationDate, iva_mode || 'none', currency || 'MXN', subtotal, iva, total, observations || null, id]
        );

        // Delete and re-insert items
        await connection.query('DELETE FROM QuotationItems WHERE quotation_id = ?', [id]);
        for (const item of items) {
            const lineAmount = parseFloat(item.unit_price) * (item.quantity || 1) * (1 - (parseFloat(item.discount_percent || 0) / 100));
            await connection.query(
                'INSERT INTO QuotationItems (quotation_id, description, unit_price, quantity, discount_percent, amount) VALUES (?, ?, ?, ?, ?, ?)',
                [id, item.description, item.unit_price, item.quantity || 1, item.discount_percent || 0, lineAmount]
            );
        }

        await connection.commit();
        return NextResponse.json({ message: 'Quotation updated successfully' });
    } catch (error: any) {
        await connection.rollback();
        console.error('Error updating quotation:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        connection.release();
    }
});
