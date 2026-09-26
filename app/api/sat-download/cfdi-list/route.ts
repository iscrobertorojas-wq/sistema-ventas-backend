import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tipo = searchParams.get('tipo');
        const fechaInicio = searchParams.get('fecha_inicio');
        const fechaFin = searchParams.get('fecha_fin');
        const estadoSat = searchParams.get('estado_sat');

        let query = `
            SELECT 
                id, uuid, tipo, rfc_emisor, nombre_emisor, rfc_receptor, nombre_receptor,
                fecha_emision, fecha_pago, subtotal, iva, ret_iva, ret_isr, ret_cedular, total, moneda, tipo_cfdi, metodo_pago,
                forma_pago, uso_cfdi, COALESCE(estado_sat, 'Vigente') AS estado_sat, created_at
            FROM SatCfdis
            WHERE 1=1
        `;
        const params: any[] = [];

        if (tipo) {
            query += ' AND tipo = ?';
            params.push(tipo);
        }
        if (fechaInicio) {
            query += ' AND fecha_emision >= ?';
            params.push(`${fechaInicio} 00:00:00`);
        }
        if (fechaFin) {
            query += ' AND fecha_emision <= ?';
            params.push(`${fechaFin} 23:59:59`);
        }
        if (estadoSat) {
            if (estadoSat === 'Vigente') {
                query += ' AND (estado_sat = "Vigente" OR estado_sat IS NULL)';
            } else {
                query += ' AND estado_sat = ?';
                params.push(estadoSat);
            }
        }

        query += ' ORDER BY fecha_emision DESC LIMIT 1000';

        const [rows] = await pool.query<RowDataPacket[]>(query, params);

        return NextResponse.json(rows);
    } catch (error: any) {
        console.error('[CFDI List] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
