import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export async function GET(
    request: Request,
    { params }: { params: { id: string } }
) {
    try {
        const { id } = params;

        // Get policy info
        const [policies] = await pool.query<RowDataPacket[]>(
            `SELECT sp.*, c.name AS client_name,
                COALESCE(SUM(psr.duration_minutes), 0) AS used_minutes,
                (sp.total_hours * 60 - COALESCE(SUM(psr.duration_minutes), 0)) AS remaining_minutes
             FROM ServicePolicies sp
             JOIN Clients c ON sp.client_id = c.id
             LEFT JOIN PolicyServiceRecords psr ON psr.policy_id = sp.id
             WHERE sp.id = ?
             GROUP BY sp.id`,
            [id]
        );

        if (policies.length === 0) {
            return NextResponse.json({ error: 'Póliza no encontrada' }, { status: 404 });
        }

        // Get records
        const [records] = await pool.query<RowDataPacket[]>(
            `SELECT * FROM PolicyServiceRecords WHERE policy_id = ? ORDER BY service_date ASC, start_time ASC`,
            [id]
        );

        return NextResponse.json({ ...policies[0], records });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
