import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');

        let query = `
      SELECT p.*, s.client_id, c.name as client_name, s.folio as sale_folio, s.type as sale_type, s.date as sale_date
      FROM Payments p 
      JOIN Sales s ON p.sale_id = s.id 
      JOIN Clients c ON s.client_id = c.id 
    `;
        const queryParams: any[] = [];

        if (startDate && endDate) {
            query += ` WHERE p.date >= ? AND p.date <= ? `;
            queryParams.push(startDate, endDate);
        }

        query += ` ORDER BY p.date DESC `;

        const [rows] = await pool.query<RowDataPacket[]>(query, queryParams);
        return NextResponse.json(rows);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const body = await request.json();
        const { sale_id, amount, method, bank_account, date } = body;

        if (!sale_id || !amount || !method) {
            return NextResponse.json({ error: 'Sale ID, amount and method are required' }, { status: 400 });
        }

        // Check Balance
        const [saleRows] = await connection.query<RowDataPacket[]>(
            'SELECT total FROM Sales WHERE id = ?',
            [sale_id]
        );
        const saleTotal = saleRows[0]?.total || 0;

        const [paymentRows] = await connection.query<RowDataPacket[]>(
            'SELECT SUM(amount) as paid FROM Payments WHERE sale_id = ?',
            [sale_id]
        );
        const totalPaid = paymentRows[0]?.paid || 0;

        if (totalPaid + amount > saleTotal + 0.01) { // Small tolerance for float
            connection.release(); // Important to release here
            return NextResponse.json({ error: 'Payment amount exceeds remaining balance' }, { status: 400 });
        }

        // Insert Payment
        const [result] = await connection.query<ResultSetHeader>(
            'INSERT INTO Payments (sale_id, amount, method, bank_account, date) VALUES (?, ?, ?, ?, ?)',
            [sale_id, amount, method, bank_account, date ? new Date(date) : new Date()]
        );
        const paymentId = result.insertId;

        // Recalculate total paid after insertion to set status
        const [newPaymentRows] = await connection.query<RowDataPacket[]>(
            'SELECT SUM(amount) as paid FROM Payments WHERE sale_id = ?',
            [sale_id]
        );
        const newTotalPaid = newPaymentRows[0]?.paid || 0;

        // Update Status if paid
        if (totalPaid >= saleTotal) {
            await connection.query('UPDATE Sales SET status = ? WHERE id = ?', ['Paid', sale_id]);
        } else {
            await connection.query('UPDATE Sales SET status = ? WHERE id = ?', ['Partial', sale_id]);
        }

        await connection.commit();
        return NextResponse.json({ id: paymentId, message: 'Payment registered successfully' }, { status: 201 });
    } catch (error: any) {
        await connection.rollback();
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        connection.release();
    }
}

export async function DELETE(request: Request) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'Payment ID is required' }, { status: 400 });
        }

        // Get Sale ID before deleting
        const [paymentRows] = await connection.query<RowDataPacket[]>(
            'SELECT sale_id FROM Payments WHERE id = ?',
            [id]
        );

        if (paymentRows.length === 0) {
            await connection.rollback();
            return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
        }
        const sale_id = paymentRows[0].sale_id;

        // Delete Payment
        await connection.query('DELETE FROM Payments WHERE id = ?', [id]);

        // Recalculate Totals
        const [saleRows] = await connection.query<RowDataPacket[]>(
            'SELECT total FROM Sales WHERE id = ?',
            [sale_id]
        );
        const saleTotal = saleRows[0]?.total || 0;

        const [totalPaidRows] = await connection.query<RowDataPacket[]>(
            'SELECT SUM(amount) as paid FROM Payments WHERE sale_id = ?',
            [sale_id]
        );
        const totalPaid = totalPaidRows[0]?.paid || 0;

        // Update Status
        let newStatus = 'Pending';
        if (totalPaid >= saleTotal) {
            newStatus = 'Paid';
        } else if (totalPaid > 0) {
            newStatus = 'Partial';
        }

        await connection.query('UPDATE Sales SET status = ? WHERE id = ?', [newStatus, sale_id]);

        await connection.commit();
        return NextResponse.json({ message: 'Payment deleted successfully' });
    } catch (error: any) {
        await connection.rollback();
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        connection.release();
    }
}

export async function PUT(request: Request) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const body = await request.json();
        const { id, amount, method, bank_account, date } = body;

        if (!id || !amount || !method) {
            return NextResponse.json({ error: 'ID, amount and method are required' }, { status: 400 });
        }

        // Get Sale ID
        const [paymentRows] = await connection.query<RowDataPacket[]>(
            'SELECT sale_id FROM Payments WHERE id = ?',
            [id]
        );

        if (paymentRows.length === 0) {
            await connection.rollback();
            return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
        }
        const sale_id = paymentRows[0].sale_id;

        // Check if new amount is valid (Total Paid - Old Amount + New Amount <= Sale Total)
        const [saleRows] = await connection.query<RowDataPacket[]>(
            'SELECT total FROM Sales WHERE id = ?',
            [sale_id]
        );
        const saleTotal = saleRows[0]?.total || 0;

        const [totalPaidRows] = await connection.query<RowDataPacket[]>(
            'SELECT SUM(amount) as paid FROM Payments WHERE sale_id = ?',
            [sale_id]
        );
        let totalPaid = totalPaidRows[0]?.paid || 0;

        // We need to subtract the old amount of THIS payment from totalPaid to get the base
        // But since we are doing a check before update, we can't easily get the 'old' amount without another query or math.
        // Easier approach: Get all OTHER payments sum
        const [otherPayments] = await connection.query<RowDataPacket[]>(
            'SELECT SUM(amount) as paid FROM Payments WHERE sale_id = ? AND id != ?',
            [sale_id, id]
        );
        const otherPaid = otherPayments[0]?.paid || 0;

        if (otherPaid + Number(amount) > saleTotal + 0.01) { // 0.01 tolerance
            return NextResponse.json({ error: 'Payment amount exceeds remaining balance' }, { status: 400 });
        }

        // Update Payment
        await connection.query(
            'UPDATE Payments SET amount = ?, method = ?, bank_account = ?, date = ? WHERE id = ?',
            [amount, method, bank_account, date ? new Date(date) : new Date(), id]
        );

        // Update Status
        let newStatus = 'Pending';
        const newTotalPaid = otherPaid + Number(amount);

        if (newTotalPaid >= saleTotal - 0.01) {
            newStatus = 'Paid';
        } else if (newTotalPaid > 0) {
            newStatus = 'Partial';
        }

        await connection.query('UPDATE Sales SET status = ? WHERE id = ?', [newStatus, sale_id]);

        await connection.commit();
        return NextResponse.json({ message: 'Payment updated successfully' });
    } catch (error: any) {
        await connection.rollback();
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        connection.release();
    }
}
