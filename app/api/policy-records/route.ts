import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const policy_id = searchParams.get('policy_id');

        if (!policy_id) {
            return NextResponse.json({ error: 'policy_id requerido' }, { status: 400 });
        }

        const [records] = await pool.query<RowDataPacket[]>(
            `SELECT * FROM PolicyServiceRecords WHERE policy_id = ? ORDER BY service_date ASC, start_time ASC`,
            [policy_id]
        );

        return NextResponse.json(records);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { policy_id, service_date, description, start_time, end_time, duration_minutes, service_type } = body;

        if (!policy_id || !service_date || !description || !start_time || !end_time || duration_minutes === undefined || !service_type) {
            return NextResponse.json({ error: 'Todos los campos son requeridos' }, { status: 400 });
        }

        // Check if policy is completed (remaining_minutes <= 0)
        const [policies] = await pool.query<RowDataPacket[]>(
            `SELECT sp.total_hours * 60 - COALESCE(SUM(psr.duration_minutes), 0) AS remaining_minutes
             FROM ServicePolicies sp
             LEFT JOIN PolicyServiceRecords psr ON psr.policy_id = sp.id
             WHERE sp.id = ?
             GROUP BY sp.id`,
            [policy_id]
        );

        if (policies.length === 0) {
            return NextResponse.json({ error: 'Póliza no encontrada' }, { status: 404 });
        }

        const remaining = parseFloat(policies[0].remaining_minutes);
        if (remaining <= 0) {
            return NextResponse.json({ error: 'La póliza ya está completada, no se pueden agregar más servicios' }, { status: 400 });
        }

        const [result] = await pool.query<ResultSetHeader>(
            `INSERT INTO PolicyServiceRecords (policy_id, service_date, description, start_time, end_time, duration_minutes, service_type)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [policy_id, service_date, description, start_time, end_time, duration_minutes, service_type]
        );

        return NextResponse.json({ id: result.insertId, message: 'Registro creado correctamente' }, { status: 201 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    try {
        const body = await request.json();
        const { id, service_date, description, start_time, end_time, duration_minutes, service_type } = body;

        if (!id || !service_date || !description || !start_time || !end_time || duration_minutes === undefined || !service_type) {
            return NextResponse.json({ error: 'Todos los campos son requeridos' }, { status: 400 });
        }

        await pool.query(
            `UPDATE PolicyServiceRecords SET service_date = ?, description = ?, start_time = ?, end_time = ?, duration_minutes = ?, service_type = ?
             WHERE id = ?`,
            [service_date, description, start_time, end_time, duration_minutes, service_type, id]
        );

        return NextResponse.json({ message: 'Registro actualizado correctamente' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'ID requerido' }, { status: 400 });
        }

        await pool.query('DELETE FROM PolicyServiceRecords WHERE id = ?', [id]);
        return NextResponse.json({ message: 'Registro eliminado correctamente' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
