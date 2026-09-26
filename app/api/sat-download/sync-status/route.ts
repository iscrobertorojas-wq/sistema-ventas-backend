import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { checkSatCfdiStatus } from '@/lib/sat-status-checker';
import { decrypt } from '@/lib/encryption';
import { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async function POST(request) {
    try {
        const body = await request.json().catch(() => ({}));
        const { fecha_inicio, fecha_fin, tipo, uuid } = body;

        let query = `
            SELECT id, uuid, rfc_emisor, rfc_receptor, total, estado_sat, xml_content 
            FROM SatCfdis 
            WHERE 1=1
        `;
        const params: any[] = [];

        if (uuid) {
            query += ' AND uuid = ?';
            params.push(String(uuid).trim().toUpperCase());
        } else {
            query += ' AND (estado_sat != "Cancelado" OR estado_sat IS NULL)';
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
        }

        const [rows] = await pool.query<RowDataPacket[]>(query, params);

        if (rows.length === 0) {
            return NextResponse.json({
                success: true,
                total_verificados: 0,
                actualizados_a_cancelado: 0,
                message: uuid ? `El comprobante con UUID ${uuid} no fue encontrado en la base de datos.` : 'No se encontraron CFDIs pendientes de verificar.'
            });
        }

        let canceladosActualizados = 0;
        let vigentesConfirmados = 0;
        const resultados: any[] = [];

        for (const row of rows) {
            let sello: string | null = null;
            if (row.xml_content) {
                try {
                    const decryptedXml = decrypt(row.xml_content).toString('utf-8');
                    const selloMatch = decryptedXml.match(/\bSello="([^"]+)"/i);
                    if (selloMatch) sello = selloMatch[1];
                } catch {
                    // Si no se puede desencriptar, continuar sin sello
                }
            }

            const status = await checkSatCfdiStatus(
                row.uuid,
                row.rfc_emisor,
                row.rfc_receptor,
                row.total,
                sello
            );

            const estadoAnterior = row.estado_sat || 'Vigente';
            let nuevoEstado = estadoAnterior;

            if (status === 'Cancelado') {
                if (estadoAnterior !== 'Cancelado') {
                    await pool.query('UPDATE SatCfdis SET estado_sat = "Cancelado" WHERE id = ?', [row.id]);
                    canceladosActualizados++;
                }
                nuevoEstado = 'Cancelado';
            } else if (status === 'Vigente') {
                if (row.estado_sat !== 'Vigente') {
                    await pool.query('UPDATE SatCfdis SET estado_sat = "Vigente" WHERE id = ?', [row.id]);
                }
                vigentesConfirmados++;
                nuevoEstado = 'Vigente';
            }

            resultados.push({
                uuid: row.uuid,
                estado_sat: nuevoEstado,
                sat_verificado: status || 'Desconocido',
                cambio: estadoAnterior !== nuevoEstado
            });
        }

        let msg = `Verificación completada: ${rows.length} comprobante(s) consultados ante el SAT.`;
        if (canceladosActualizados > 0) {
            msg += ` Se detectaron y actualizaron ${canceladosActualizados} a estatus Cancelado.`;
        } else {
            msg += ` Todos se mantienen con su estatus actual.`;
        }

        return NextResponse.json({
            success: true,
            total_verificados: rows.length,
            actualizados_a_cancelado: canceladosActualizados,
            vigentes_confirmados: vigentesConfirmados,
            resultados,
            message: msg
        });
    } catch (error: any) {
        console.error('[SAT Sync Status] Error:', error);
        return NextResponse.json({ error: error.message || 'Error al sincronizar estatus' }, { status: 500 });
    }
});
