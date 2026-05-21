import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import { withAuth } from '@/lib/auth';

export const GET = withAuth(async function GET() {
    try {
        const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM ContpaqiProducts ORDER BY description ASC');
        return NextResponse.json(rows);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const POST = withAuth(async function POST(request) {
    try {
        const body = await request.json();
        const { description, price } = body;

        if (!description || price === undefined || price === null) {
            return NextResponse.json({ error: 'Description and price are required' }, { status: 400 });
        }

        const numericPrice = parseFloat(price);
        if (isNaN(numericPrice) || numericPrice < 0) {
            return NextResponse.json({ error: 'Price must be a valid positive number' }, { status: 400 });
        }

        const [result] = await pool.query(
            'INSERT INTO ContpaqiProducts (description, price) VALUES (?, ?)',
            [description, numericPrice]
        );

        const insertId = (result as any).insertId;
        return NextResponse.json({ id: insertId, description, price: numericPrice }, { status: 201 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const PUT = withAuth(async function PUT(request) {
    try {
        const body = await request.json();
        const { id, description, price } = body;

        if (!id || !description || price === undefined || price === null) {
            return NextResponse.json({ error: 'ID, description and price are required' }, { status: 400 });
        }

        const numericPrice = parseFloat(price);
        if (isNaN(numericPrice) || numericPrice < 0) {
            return NextResponse.json({ error: 'Price must be a valid positive number' }, { status: 400 });
        }

        await pool.query(
            'UPDATE ContpaqiProducts SET description = ?, price = ? WHERE id = ?',
            [description, numericPrice, id]
        );

        return NextResponse.json({ id, description, price: numericPrice });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const DELETE = withAuth(async function DELETE(request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'ID is required' }, { status: 400 });
        }

        await pool.query('DELETE FROM ContpaqiProducts WHERE id = ?', [id]);

        return NextResponse.json({ message: 'Producto de Contpaqi eliminado correctamente' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
