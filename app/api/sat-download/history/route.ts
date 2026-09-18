import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async function GET() {
    try {
        const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT 
                id, request_id, tipo, fecha_inicio, fecha_fin, 
                estado, total_cfdis, mensaje_error, created_at, updated_at
             FROM SatDownloadRequests 
             ORDER BY created_at DESC 
             LIMIT 100`
        );

        return NextResponse.json(rows);
    } catch (error: any) {
        console.error('[SAT History] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
