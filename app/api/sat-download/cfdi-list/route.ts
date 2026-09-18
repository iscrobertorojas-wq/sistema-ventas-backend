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

        let query = `
            SELECT 
                id, uuid, tipo, rfc_emisor, nombre_emisor, rfc_receptor, nombre_receptor,
                fecha_emision, subtotal, iva, ret_iva, ret_isr, ret_cedular, total, moneda, tipo_cfdi, metodo_pago,
                forma_pago, uso_cfdi, estado_sat, created_at
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

        query += ' ORDER BY fecha_emision DESC LIMIT 1000';

        const [rows] = await pool.query<RowDataPacket[]>(query, params);

        // NOTA: xml_content NO se devuelve aquí por seguridad. Solo metadatos.
        return NextResponse.json(rows);
    } catch (error: any) {
        console.error('[CFDI List] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
