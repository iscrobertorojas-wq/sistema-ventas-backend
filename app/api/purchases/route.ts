import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');

        let query = `
            SELECT 
                p.id,
                p.supplier_id,
                s.name as supplier_name,
                p.date,
                p.total,
                p.notes,
                p.created_at,
                (
                    SELECT GROUP_CONCAT(description SEPARATOR ', ')
                    FROM PurchaseItems
                    WHERE purchase_id = p.id
                ) as items_description
            FROM Purchases p
            JOIN Suppliers s ON p.supplier_id = s.id
        `;
        const params: any[] = [];

        if (startDate && endDate) {
            query += ' WHERE p.date >= ? AND p.date <= ?';
            params.push(startDate, endDate);
        } else if (startDate) {
            query += ' WHERE p.date >= ?';
            params.push(startDate);
        }

        query += ' ORDER BY p.date DESC, p.id DESC';

        const [rows] = await pool.query<RowDataPacket[]>(query, params);
        return NextResponse.json(rows);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { supplier_id, date, notes, items } = body;

        if (!supplier_id) {
            return NextResponse.json({ error: 'El proveedor es requerido' }, { status: 400 });
        }

        if (!items || items.length === 0) {
            return NextResponse.json({ error: 'Debe agregar al menos un ítem' }, { status: 400 });
        }

        // Validate items
        for (const item of items) {
            if (!item.description || item.description.trim() === '') {
                return NextResponse.json({ error: 'Todos los ítems deben tener descripción' }, { status: 400 });
            }
            if (!item.cost || isNaN(parseFloat(item.cost)) || parseFloat(item.cost) <= 0) {
                return NextResponse.json({ error: 'Todos los ítems deben tener un costo válido mayor a 0' }, { status: 400 });
            }
        }

        // Calculate total
        const total = items.reduce((sum: number, item: any) => sum + parseFloat(item.cost), 0);

        const purchaseDate = date || new Date().toISOString().split('T')[0];

        // Insert Purchase
        const [result] = await pool.query(
            'INSERT INTO Purchases (supplier_id, date, total, notes) VALUES (?, ?, ?, ?)',
            [supplier_id, purchaseDate, total, notes || null]
        );

        const purchaseId = (result as any).insertId;

        // Insert PurchaseItems
        for (const item of items) {
            await pool.query(
                'INSERT INTO PurchaseItems (purchase_id, description, cost) VALUES (?, ?, ?)',
                [purchaseId, item.description.trim(), parseFloat(item.cost)]
            );
        }

        return NextResponse.json({
            id: purchaseId,
            supplier_id,
            date: purchaseDate,
            total,
            notes,
            items
        }, { status: 201 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const body = await request.json();
        const { id, supplier_id, date, notes, items } = body;

        if (!id || !supplier_id || !items || items.length === 0) {
            return NextResponse.json({ error: 'ID, proveedor e ítems son requeridos' }, { status: 400 });
        }

        // Calculate new total
        const total = items.reduce((sum: number, item: any) => sum + parseFloat(item.cost), 0);
        const purchaseDate = date || new Date().toISOString().split('T')[0];

        // Update Purchase
        await connection.query(
            'UPDATE Purchases SET supplier_id = ?, date = ?, total = ?, notes = ? WHERE id = ?',
            [supplier_id, purchaseDate, total, notes || null, id]
        );

        // Update Items (Delete and Re-insert)
        await connection.query('DELETE FROM PurchaseItems WHERE purchase_id = ?', [id]);
        for (const item of items) {
            await connection.query(
                'INSERT INTO PurchaseItems (purchase_id, description, cost) VALUES (?, ?, ?)',
                [id, item.description.trim(), parseFloat(item.cost)]
            );
        }

        await connection.commit();
        return NextResponse.json({ message: 'Compra actualizada correctamente' });
    } catch (error: any) {
        await connection.rollback();
        console.error('Error updating purchase:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        connection.release();
    }
}

