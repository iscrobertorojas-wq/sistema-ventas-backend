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
            SELECT c.id as client_id, c.name as client_name, COUNT(s.id) as sales_count, SUM(s.total) as total_amount
            FROM Clients c
            JOIN Sales s ON c.id = s.client_id
        `;
        const queryParams: any[] = [];

        if (startDate && endDate) {
            query += ` WHERE s.date >= ? AND s.date <= ? `;
            queryParams.push(startDate, endDate);
        }

        query += ` GROUP BY c.id, c.name ORDER BY total_amount DESC `;

        const [rows] = await pool.query<RowDataPacket[]>(query, queryParams);
        return NextResponse.json(rows);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
