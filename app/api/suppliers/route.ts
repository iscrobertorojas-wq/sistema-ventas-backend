import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export async function GET() {
    try {
        const query = `
            SELECT 
                s.*,
                (SELECT COUNT(*) FROM Purchases p WHERE p.supplier_id = s.id) as purchases_count
            FROM Suppliers s
            ORDER BY s.name ASC
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
            return NextResponse.json({ error: 'El nombre es requerido' }, { status: 400 });
        }

        // Check if name already exists
        const [existing] = await pool.query<RowDataPacket[]>(
            'SELECT id FROM Suppliers WHERE name = ?',
            [name]
        );

        if (existing.length > 0) {
            return NextResponse.json({ error: 'El nombre del proveedor ya existe' }, { status: 409 });
        }

        const [result] = await pool.query(
            'INSERT INTO Suppliers (name, phone, address) VALUES (?, ?, ?)',
            [name, phone || null, address || null]
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
            return NextResponse.json({ error: 'ID y Nombre son requeridos' }, { status: 400 });
        }

        // Check if name exists for OTHER suppliers
        const [existing] = await pool.query<RowDataPacket[]>(
            'SELECT id FROM Suppliers WHERE name = ? AND id != ?',
            [name, id]
        );

        if (existing.length > 0) {
            return NextResponse.json({ error: 'El nombre del proveedor ya existe' }, { status: 409 });
        }

        await pool.query(
            'UPDATE Suppliers SET name = ?, phone = ?, address = ? WHERE id = ?',
            [name, phone || null, address || null, id]
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
            return NextResponse.json({ error: 'ID es requerido' }, { status: 400 });
        }

        // Check if supplier has purchases
        const [purchases] = await pool.query<RowDataPacket[]>(
            'SELECT id FROM Purchases WHERE supplier_id = ?',
            [id]
        );

        if (purchases.length > 0) {
            return NextResponse.json({
                error: 'No se puede eliminar el proveedor porque tiene compras asociadas'
            }, { status: 400 });
        }

        await pool.query('DELETE FROM Suppliers WHERE id = ?', [id]);

        return NextResponse.json({ message: 'Proveedor eliminado correctamente' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
