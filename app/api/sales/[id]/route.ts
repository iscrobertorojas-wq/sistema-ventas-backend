import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const [sales] = await pool.query<RowDataPacket[]>(
            'SELECT * FROM Sales WHERE id = ?',
            [id]
        );

        if (sales.length === 0) {
            return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
        }

        const sale = sales[0];

        // Get Items
        const [items] = await pool.query<RowDataPacket[]>(
            'SELECT * FROM SaleItems WHERE sale_id = ?',
            [id]
        );

        // Get Client
        const [clients] = await pool.query<RowDataPacket[]>(
            'SELECT * FROM Clients WHERE id = ?',
            [sale.client_id]
        );

        return NextResponse.json({
            ...sale,
            items,
            client: clients[0] || null
        });
    } catch (error) {
        console.error('Error fetching sale:', error);
        return NextResponse.json(
            { error: 'Error fetching sale' },
            { status: 500 }
        );
    }
}
