import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { checkSatCfdiStatus } from '@/lib/sat-status-checker';
import { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async function POST(request) {
    try {
        const body = await request.json().catch(() => ({}));
        const { fecha_inicio, fecha_fin, tipo } = body;

        let query = `
            SELECT id, uuid, rfc_emisor, rfc_receptor, total, estado_sat 
            FROM SatCfdis 
            WHERE (estado_sat != 'Cancelado' OR estado_sat IS NULL)
        `;
        const params: any[] = [];

        if (tipo) {
            query += ' AND tipo = ?';
            params.push(tipo);
        }
        if (fecha_inicio) {
            query += ' AND fecha_emision >= ?';
            params.push(`${fecha_inicio} 00:00:00`);
        }
        if (fecha_fin) {
            query += ' AND fecha_emision <= ?';
            params.push(`${fecha_fin} 23:59:59`);
        }

        query += ' ORDER BY fecha_emision DESC LIMIT 200';

        const [rows] = await pool.query<RowDataPacket[]>(query, params);

        let canceladosActualizados = 0;

        for (const row of rows) {
            const status = await checkSatCfdiStatus(
                row.uuid,
                row.rfc_emisor,
                row.rfc_receptor,
                row.total
            );

            if (status === 'Cancelado') {
                await pool.query('UPDATE SatCfdis SET estado_sat = "Cancelado" WHERE id = ?', [row.id]);
                canceladosActualizados++;
            } else if (status === 'Vigente' && !row.estado_sat) {
                await pool.query('UPDATE SatCfdis SET estado_sat = "Vigente" WHERE id = ?', [row.id]);
            }
        }

        return NextResponse.json({
            success: true,
            total_verificados: rows.length,
            actualizados_a_cancelado: canceladosActualizados,
            message: `Verificación completada: ${rows.length} CFDIs verificados con el SAT. ${canceladosActualizados} detectados como Cancelados y actualizados.`
        });
    } catch (error: any) {
        console.error('[SAT Sync Status] Error:', error);
        return NextResponse.json({ error: error.message || 'Error al sincronizar estatus' }, { status: 500 });
    }
});
