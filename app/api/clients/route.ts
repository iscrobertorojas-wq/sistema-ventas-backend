import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export async function GET() {
    try {
        const query = `
            SELECT 
                c.*,
                COALESCE((
                    SELECT SUM(s.total - COALESCE((SELECT SUM(amount) FROM Payments p WHERE p.sale_id = s.id), 0))
                    FROM Sales s
                    WHERE s.client_id = c.id
                ), 0) as pending_balance
            FROM Clients c
            ORDER BY c.name ASC
        `;
        const [rows] = await pool.query<RowDataPacket[]>(query);
        return NextResponse.json(rows);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { name, phone, address } = body;

        if (!name) {
            return NextResponse.json({ error: 'Name is required' }, { status: 400 });
        }

        // Check if name already exists
        const [existing] = await pool.query<RowDataPacket[]>(
            'SELECT id FROM Clients WHERE name = ?',
            [name]
        );

        if (existing.length > 0) {
            return NextResponse.json({ error: 'El nombre del cliente ya existe' }, { status: 409 });
        }

        const [result] = await pool.query(
            'INSERT INTO Clients (name, phone, address) VALUES (?, ?, ?)',
            [name, phone, address]
        );

        const insertId = (result as any).insertId;
        return NextResponse.json({ id: insertId, name, phone, address }, { status: 201 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    try {
        const body = await request.json();
        const { id, name, phone, address } = body;

        if (!id || !name) {
            return NextResponse.json({ error: 'ID and Name are required' }, { status: 400 });
        }

        // Check if name exists for OTHER clients
        const [existing] = await pool.query<RowDataPacket[]>(
            'SELECT id FROM Clients WHERE name = ? AND id != ?',
            [name, id]
        );

        if (existing.length > 0) {
            return NextResponse.json({ error: 'El nombre del cliente ya existe' }, { status: 409 });
        }

        await pool.query(
            'UPDATE Clients SET name = ?, phone = ?, address = ? WHERE id = ?',
            [name, phone, address, id]
        );

        return NextResponse.json({ id, name, phone, address });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'ID is required' }, { status: 400 });
        }

        // Check if client has sales
        const [sales] = await pool.query<RowDataPacket[]>(
            'SELECT id FROM Sales WHERE client_id = ?',
            [id]
        );

        if (sales.length > 0) {
            return NextResponse.json({
                error: 'No se puede eliminar el cliente porque tiene ventas asociadas'
            }, { status: 400 });
        }

        await pool.query('DELETE FROM Clients WHERE id = ?', [id]);

        return NextResponse.json({ message: 'Cliente eliminado correctamente' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
