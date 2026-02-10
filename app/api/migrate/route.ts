import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET() {
    try {
        const connection = await pool.getConnection();
        await connection.query('ALTER TABLE Sales ADD COLUMN observations TEXT AFTER total;');
        connection.release();
        return NextResponse.json({ message: 'Migration successful: observations column added to Sales' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
