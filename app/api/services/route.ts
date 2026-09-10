import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import { withAuth } from '@/lib/auth';

export const GET = withAuth(async function GET() {
    try {
        const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM Services ORDER BY description ASC');
        return NextResponse.json(rows);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const POST = withAuth(async function POST(request) {
    try {
        const body = await request.json();
        const { description, price } = body;

        if (!description || price === undefined) {
            return NextResponse.json({ error: 'Description and price are required' }, { status: 400 });
        }

        const [result] = await pool.query(
            'INSERT INTO Services (description, price) VALUES (?, ?)',
            [description, price]
        );

        const insertId = (result as any).insertId;
        return NextResponse.json({ id: insertId, description, price }, { status: 201 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const PUT = withAuth(async function PUT(request: Request) {
    try {
        const body = await request.json();
        const { id, description, price } = body;

        if (!id || !description || price === undefined) {
            return NextResponse.json({ error: 'ID, descripción y precio son requeridos' }, { status: 400 });
        }

        await pool.query(
            'UPDATE Services SET description = ?, price = ? WHERE id = ?',
            [description.trim(), price, id]
        );

        return NextResponse.json({ id, description: description.trim(), price });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const DELETE = withAuth(async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'ID es requerido' }, { status: 400 });
        }

        // Check if service is used in any sale
        const [saleItems] = await pool.query<RowDataPacket[]>(
            'SELECT id FROM SaleItems WHERE service_id = ? LIMIT 1',
            [id]
        );

        if (saleItems.length > 0) {
            return NextResponse.json({
                error: 'No se puede eliminar el servicio porque está registrado en una o más ventas'
            }, { status: 400 });
        }

        await pool.query('DELETE FROM Services WHERE id = ?', [id]);

        return NextResponse.json({ message: 'Servicio eliminado correctamente' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
