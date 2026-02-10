import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');

        let dateFilter = '';
        const params: any[] = [];

        if (startDate && endDate) {
            dateFilter = 'AND s.date BETWEEN ? AND ?';
            params.push(startDate, endDate);
        }

        const query = `
      SELECT 
        s.id,
        s.folio,
        s.date,
        s.type,
        s.total,
        s.status,
        c.id as client_id,
        c.name as client_name,
        c.phone as client_phone,
        (
            SELECT GROUP_CONCAT(CONCAT(srv.description, IF(si.notes IS NOT NULL AND si.notes != '', CONCAT(' - ', si.notes), '')) SEPARATOR ', ')
            FROM SaleItems si
            JOIN Services srv ON si.service_id = srv.id
            WHERE si.sale_id = s.id
        ) as services,
        COALESCE((SELECT SUM(amount) FROM Payments WHERE sale_id = s.id), 0) as paid_amount,
        (SELECT MAX(date) FROM Payments WHERE sale_id = s.id) as last_payment_date,
        (SELECT GROUP_CONCAT(DISTINCT method SEPARATOR ', ') FROM Payments WHERE sale_id = s.id) as payment_methods,
        (SELECT GROUP_CONCAT(DISTINCT bank_account SEPARATOR ', ') FROM Payments WHERE sale_id = s.id) as bank_accounts
      FROM Sales s
      JOIN Clients c ON s.client_id = c.id
      WHERE 1=1 ${dateFilter}
      ORDER BY s.date DESC
    `;

        const [rows] = await pool.query<RowDataPacket[]>(query, params);
        return NextResponse.json(rows);
    } catch (error: any) {
        console.error('Error fetching sales:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const body = await request.json();
        const { client_id, type, items, date, observations } = body; // items: { service_id, price, notes }[]

        if (!client_id || !items || items.length === 0) {
            return NextResponse.json({ error: 'Client and items are required' }, { status: 400 });
        }

        // Calculate total
        const total = items.reduce((sum: number, item: any) => sum + parseFloat(item.price), 0);

        // Get current folio based on type
        const settingKey = type === 'Invoice' ? 'folio_invoice' : 'folio_remission';
        const [settings] = await connection.query<RowDataPacket[]>(
            'SELECT setting_value FROM Settings WHERE setting_key = ?',
            [settingKey]
        );

        let currentFolio = 1;
        if (settings.length > 0) {
            currentFolio = parseInt(settings[0].setting_value);
        }

        // Generate folio string
        const prefix = type === 'Invoice' ? 'F' : 'R';
        const folio = `${prefix}-${currentFolio}`;

        const saleDate = date ? new Date(date) : new Date();

        // Insert Sale with folio and optional date
        const [saleResult] = await connection.query<ResultSetHeader>(
            'INSERT INTO Sales (folio, client_id, type, status, total, date, observations) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [folio, client_id, type || 'Remission', 'Pending', total, saleDate, observations || null]
        );
        const saleId = saleResult.insertId;

        // Insert Sale Items
        for (const item of items) {
            await connection.query(
                'INSERT INTO SaleItems (sale_id, service_id, price, notes) VALUES (?, ?, ?, ?)',
                [saleId, item.service_id, item.price, item.notes]
            );
        }

        // Update folio counter
        const nextFolio = currentFolio + 1;
        await connection.query(
            'UPDATE Settings SET setting_value = ? WHERE setting_key = ?',
            [nextFolio.toString(), settingKey]
        );

        await connection.commit();

        return NextResponse.json({ id: saleId, folio, message: 'Sale created successfully' }, { status: 201 });
    } catch (error: any) {
        await connection.rollback();
        console.error('Error creating sale:', error);
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
        const { id, client_id, type, items, date, observations } = body;

        if (!id || !client_id || !items || items.length === 0) {
            return NextResponse.json({ error: 'ID, Client and items are required' }, { status: 400 });
        }

        // 1. Validate: Cannot edit if sale has payments
        const [payments] = await connection.query<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM Payments WHERE sale_id = ?',
            [id]
        );

        if (payments[0].count > 0) {
            return NextResponse.json({ error: 'No se puede editar una venta que ya tiene pagos asociados.' }, { status: 400 });
        }

        // 2. Calculate new total
        const total = items.reduce((sum: number, item: any) => sum + parseFloat(item.price), 0);
        const saleDate = date ? new Date(date) : new Date();

        // 3. Update Sale
        await connection.query(
            'UPDATE Sales SET client_id = ?, type = ?, total = ?, date = ?, observations = ? WHERE id = ?',
            [client_id, type, total, saleDate, observations || null, id]
        );

        // 4. Update Items (Delete and Re-insert)
        await connection.query('DELETE FROM SaleItems WHERE sale_id = ?', [id]);
        for (const item of items) {
            await connection.query(
                'INSERT INTO SaleItems (sale_id, service_id, price, notes) VALUES (?, ?, ?, ?)',
                [id, item.service_id, item.price, item.notes]
            );
        }

        await connection.commit();
        return NextResponse.json({ message: 'Sale updated successfully' });
    } catch (error: any) {
        await connection.rollback();
        console.error('Error updating sale:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        connection.release();
    }
}
