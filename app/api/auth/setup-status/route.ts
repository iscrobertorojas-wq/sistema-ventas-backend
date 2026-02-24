import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export async function GET() {
    try {
        const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) as count FROM Users');
        const isSetup = rows[0].count > 0;
        return NextResponse.json({ isSetup });
    } catch (error: any) {
        // If table doesn't exist, it means setup is not done
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return NextResponse.json({ isSetup: false });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
