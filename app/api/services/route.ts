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
