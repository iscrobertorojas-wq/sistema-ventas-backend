import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export async function GET() {
    try {
        const query = `
            SELECT
                sp.id,
                sp.policy_number,
                sp.date,
                sp.total_hours,
                sp.client_id,
                c.name AS client_name,
                COALESCE(SUM(psr.duration_minutes), 0) AS used_minutes,
                (sp.total_hours * 60 - COALESCE(SUM(psr.duration_minutes), 0)) AS remaining_minutes
            FROM ServicePolicies sp
            JOIN Clients c ON sp.client_id = c.id
            LEFT JOIN PolicyServiceRecords psr ON psr.policy_id = sp.id
            GROUP BY sp.id, sp.policy_number, sp.date, sp.total_hours, sp.client_id, c.name
            ORDER BY sp.date DESC
        `;
        const [rows] = await pool.query<RowDataPacket[]>(query);
        return NextResponse.json(rows);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { client_id, policy_number, date, total_hours } = body;

        if (!client_id || !policy_number || !date || !total_hours) {
            return NextResponse.json({ error: 'Todos los campos son requeridos' }, { status: 400 });
        }

        // Check duplicate policy_number FOR THE SAME CLIENT
        const [existing] = await pool.query<RowDataPacket[]>(
            'SELECT id FROM ServicePolicies WHERE policy_number = ? AND client_id = ?',
            [policy_number, client_id]
        );
        if (existing.length > 0) {
            return NextResponse.json({ error: 'Este cliente ya tiene una póliza con ese número' }, { status: 409 });
        }

        const [result] = await pool.query<ResultSetHeader>(
            'INSERT INTO ServicePolicies (client_id, policy_number, date, total_hours) VALUES (?, ?, ?, ?)',
            [client_id, policy_number, date, total_hours]
        );

        return NextResponse.json({ id: result.insertId, message: 'Póliza creada correctamente' }, { status: 201 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    try {
        const body = await request.json();
        const { id, client_id, policy_number, date, total_hours } = body;

        if (!id || !client_id || !policy_number || !date || !total_hours) {
            return NextResponse.json({ error: 'Todos los campos son requeridos' }, { status: 400 });
        }

        // Check duplicate policy_number FOR THE SAME CLIENT (excluding current policy)
        const [existing] = await pool.query<RowDataPacket[]>(
            'SELECT id FROM ServicePolicies WHERE policy_number = ? AND client_id = ? AND id != ?',
            [policy_number, client_id, id]
        );
        if (existing.length > 0) {
            return NextResponse.json({ error: 'Este cliente ya tiene una póliza con ese número' }, { status: 409 });
        }

        await pool.query(
            'UPDATE ServicePolicies SET client_id = ?, policy_number = ?, date = ?, total_hours = ? WHERE id = ?',
            [client_id, policy_number, date, total_hours, id]
        );

        return NextResponse.json({ message: 'Póliza actualizada correctamente' });
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

        await pool.query('DELETE FROM ServicePolicies WHERE id = ?', [id]);
        return NextResponse.json({ message: 'Póliza eliminada correctamente' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
