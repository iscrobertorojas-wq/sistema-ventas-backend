import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

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

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const connection = await pool.getConnection();
    try {
        const { id } = await params;
        await connection.beginTransaction();

        // Items are deleted automatically if ON DELETE CASCADE is set, but let's be safe
        await connection.query('DELETE FROM QuotationItems WHERE quotation_id = ?', [id]);
        
        const [result] = await connection.query<ResultSetHeader>(
            'DELETE FROM Quotations WHERE id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
        }

        await connection.commit();
        return NextResponse.json({ message: 'Quotation deleted successfully' });
    } catch (error: any) {
        await connection.rollback();
        console.error('Error deleting quotation:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        connection.release();
    }
}
