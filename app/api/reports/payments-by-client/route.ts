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
            SELECT c.id as client_id, c.name as client_name, COUNT(p.id) as payments_count, SUM(p.amount) as total_paid
            FROM Clients c
            JOIN Sales s ON c.id = s.client_id
            JOIN Payments p ON s.id = p.sale_id
        `;
        const queryParams: any[] = [];

        if (startDate && endDate) {
            query += ` WHERE p.date >= ? AND p.date <= ? `;
            queryParams.push(startDate, endDate);
        }

        query += ` GROUP BY c.id, c.name ORDER BY total_paid DESC `;

        const [rows] = await pool.query<RowDataPacket[]>(query, queryParams);
        return NextResponse.json(rows);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
