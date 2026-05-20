import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import { withAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const [purchases] = await pool.query<RowDataPacket[]>(
            `SELECT p.*, s.name as supplier_name 
             FROM Purchases p 
             JOIN Suppliers s ON p.supplier_id = s.id 
             WHERE p.id = ?`,
            [id]
        );

        if (purchases.length === 0) {
            return NextResponse.json({ error: 'Compra no encontrada' }, { status: 404 });
        }

        const purchase = purchases[0];

        // Get Items
        const [items] = await pool.query<RowDataPacket[]>(
            'SELECT * FROM PurchaseItems WHERE purchase_id = ?',
            [id]
        );

        return NextResponse.json({
            ...purchase,
            items
        });
    } catch (error: any) {
        console.error('Error fetching purchase:', error);
        return NextResponse.json(
            { error: 'Error al obtener la compra: ' + error.message },
            { status: 500 }
        );
    }
});
