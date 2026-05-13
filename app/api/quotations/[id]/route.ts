import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;

        const [quotations] = await pool.query<RowDataPacket[]>(
            `SELECT q.*, c.name as client_name, c.phone as client_phone, c.address as client_address
             FROM Quotations q
             JOIN Clients c ON q.client_id = c.id
             WHERE q.id = ?`,
            [id]
        );

        if (quotations.length === 0) {
            return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
        }

        const [items] = await pool.query<RowDataPacket[]>(
            'SELECT * FROM QuotationItems WHERE quotation_id = ? ORDER BY id',
            [id]
        );

        return NextResponse.json({
            ...quotations[0],
            items
        });
    } catch (error: any) {
        console.error('Error fetching quotation:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
