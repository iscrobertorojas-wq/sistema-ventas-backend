import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export async function GET() {
    try {
        const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM Clients ORDER BY name ASC');
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
