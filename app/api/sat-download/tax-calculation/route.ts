import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';

function getIsrBracket(ingresos: number): { tasa: number; porcentaje: string; tope: number } {
    if (ingresos <= 25000) return { tasa: 0.01, porcentaje: '1.00%', tope: 25000 };
    if (ingresos <= 50000) return { tasa: 0.011, porcentaje: '1.10%', tope: 50000 };
    if (ingresos <= 83333.33) return { tasa: 0.015, porcentaje: '1.50%', tope: 83333.33 };
    if (ingresos <= 208333.33) return { tasa: 0.02, porcentaje: '2.00%', tope: 208333.33 };
    return { tasa: 0.025, porcentaje: '2.50%', tope: 3500000 };
}

function getCedularBracket(ingresos: number): { tasa: number; porcentaje: string; tope: number } {
    if (ingresos <= 25000) return { tasa: 0.02, porcentaje: '2.00%', tope: 25000 };
    if (ingresos <= 50000) return { tasa: 0.021, porcentaje: '2.10%', tope: 50000 };
    if (ingresos <= 83333.33) return { tasa: 0.022, porcentaje: '2.20%', tope: 83333.33 };
    if (ingresos <= 208333.33) return { tasa: 0.023, porcentaje: '2.30%', tope: 208333.33 };
    return { tasa: 0.025, porcentaje: '2.50%', tope: 3500000 };
}

export const GET = withAuth(async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const anio = parseInt(searchParams.get('anio') || String(new Date().getFullYear()), 10);
        const mes = parseInt(searchParams.get('mes') || String(new Date().getMonth() + 1), 10);

        const mesStr = String(mes).padStart(2, '0');
        const lastDay = new Date(anio, mes, 0).getDate();
        const fechaInicio = `${anio}-${mesStr}-01 00:00:00`;
        const fechaFin = `${anio}-${mesStr}-${String(lastDay).padStart(2, '0')} 23:59:59`;

        // 1. EMITIDOS DIRECTOS (PUE o comprobantes no PPD)
        // Regla: No considerar PPD ni cancelados
        const [emitidosPueRows] = await pool.query<RowDataPacket[]>(`
            SELECT 
                id, uuid, tipo, rfc_emisor, nombre_emisor, rfc_receptor, nombre_receptor,
                fecha_emision, fecha_pago, subtotal, iva, ret_iva, ret_isr, ret_cedular, total, 
                moneda, tipo_cfdi, metodo_pago, forma_pago, uso_cfdi, estado_sat,
                'PUE' AS origen,
                NULL AS uuid_relacionado,
                NULL AS docto_relacionado_uuid
            FROM SatCfdis
            WHERE tipo = 'emitido'
              AND (estado_sat != 'Cancelado' OR estado_sat IS NULL)
              AND (metodo_pago != 'PPD' OR metodo_pago IS NULL)
              AND tipo_cfdi != 'P'
              AND fecha_emision >= ? AND fecha_emision <= ?
            ORDER BY fecha_emision ASC
        `, [fechaInicio, fechaFin]);

        // 2. COMPLEMENTOS DE PAGO RELACIONADOS A FACTURAS EMITIDAS PPD
        // Regla: Buscar XMLs emitidos de tipo pago relacionados a facturas PPD,
        // cuya FECHA DE PAGO sea en el mes que se está calculando.
        let emitidosPagosRows: RowDataPacket[] = [];
        try {
            const [pagos] = await pool.query<RowDataPacket[]>(`
                SELECT 
                    c_pago.id,
                    c_pago.uuid,
                    'emitido' AS tipo,
                    c_pago.rfc_emisor,
                    c_pago.nombre_emisor,
                    COALESCE(c_ppd.rfc_receptor, c_pago.rfc_receptor) AS rfc_receptor,
                    COALESCE(c_ppd.nombre_receptor, c_pago.nombre_receptor) AS nombre_receptor,
                    c_pago.fecha_emision,
                    p.fecha_pago,
                    p.subtotal,
                    p.iva,
                    p.ret_iva,
                    p.ret_isr,
                    p.ret_cedular,
                    p.monto_pagado AS total,
                    p.moneda,
                    'P' AS tipo_cfdi,
                    'PPD' AS metodo_pago,
                    p.forma_pago,
                    c_pago.uso_cfdi,
                    c_pago.estado_sat,
                    'PPD_PAGO' AS origen,
                    p.docto_relacionado_uuid AS uuid_relacionado,
                    p.docto_relacionado_uuid
                FROM SatCfdiPagos p
                JOIN SatCfdis c_pago ON p.cfdi_pago_id = c_pago.id
                LEFT JOIN SatCfdis c_ppd ON p.docto_relacionado_uuid = c_ppd.uuid
                WHERE c_pago.tipo = 'emitido'
                  AND (c_pago.estado_sat != 'Cancelado' OR c_pago.estado_sat IS NULL)
                  AND (c_ppd.id IS NULL OR c_ppd.estado_sat != 'Cancelado' OR c_ppd.estado_sat IS NULL)
                  AND p.fecha_pago >= ? AND p.fecha_pago <= ?
                ORDER BY p.fecha_pago ASC
            `, [fechaInicio, fechaFin]);
            emitidosPagosRows = pagos;
        } catch (err: any) {
            console.warn('[Tax Calc] Tabla SatCfdiPagos aún no disponible o vacía:', err.message);
        }

        // Combinar todos los emitidos considerados en el cálculo
        const emitidosConsiderados = [...emitidosPueRows, ...emitidosPagosRows].map(item => {
            const rfcReceptor = (item.rfc_receptor || '').trim();
            const esMoral = rfcReceptor.length === 12;
            const esFisica = rfcReceptor.length === 13;
            const subtotal = parseFloat(item.subtotal || 0);
            const iva = parseFloat(item.iva || 0);
            let retIsr = parseFloat(item.ret_isr || 0);
            const retIva = parseFloat(item.ret_iva || 0);
            const retCedular = parseFloat(item.ret_cedular || 0);
            const total = parseFloat(item.total || 0);

            // Si es PM y no venía retención explícita, calcular retención ISR RESICO 1.25%
            if (esMoral && retIsr === 0 && subtotal > 0) {
                retIsr = Math.round(subtotal * 0.0125 * 100) / 100;
            }

            return {
                ...item,
                subtotal,
                iva,
                ret_isr: retIsr,
                ret_iva: retIva,
                ret_cedular: retCedular,
                total,
                es_persona_moral: esMoral,
                es_persona_fisica: esFisica,
                tipo_receptor: esFisica ? 'Persona Física' : (esMoral ? 'Persona Moral' : 'Otro')
            };
        });

        // 3. RECIBIDOS VIGENTES (Gastos / IVA Acreditable)
        const [recibidosRows] = await pool.query<RowDataPacket[]>(`
            SELECT 
                id, uuid, tipo, rfc_emisor, nombre_emisor, rfc_receptor, nombre_receptor,
                fecha_emision, subtotal, iva, ret_iva, ret_isr, ret_cedular, total, 
                moneda, tipo_cfdi, metodo_pago, forma_pago, uso_cfdi, estado_sat
            FROM SatCfdis
            WHERE tipo = 'recibido'
              AND (estado_sat != 'Cancelado' OR estado_sat IS NULL)
              AND fecha_emision >= ? AND fecha_emision <= ?
            ORDER BY fecha_emision ASC
        `, [fechaInicio, fechaFin]);

        const recibidosConsiderados = recibidosRows.map(r => ({
            ...r,
            subtotal: parseFloat(r.subtotal || 0),
            iva: parseFloat(r.iva || 0),
            total: parseFloat(r.total || 0),
        }));

        // 4. FACTURAS PPD EMITIDAS EXCLUIDAS DEL MES (Para auditoría y transparencia)
        const [ppdExcluidosRows] = await pool.query<RowDataPacket[]>(`
            SELECT 
                id, uuid, fecha_emision, subtotal, iva, ret_isr, ret_iva, total, 
                rfc_receptor, nombre_receptor, metodo_pago
            FROM SatCfdis
            WHERE tipo = 'emitido'
              AND metodo_pago = 'PPD'
              AND (estado_sat != 'Cancelado' OR estado_sat IS NULL)
              AND fecha_emision >= ? AND fecha_emision <= ?
            ORDER BY fecha_emision ASC
        `, [fechaInicio, fechaFin]);

        // 5. CFDIs CANCELADOS EXCLUIDOS DEL MES
        const [canceladosRows] = await pool.query<RowDataPacket[]>(`
            SELECT 
                id, uuid, tipo, fecha_emision, subtotal, iva, total,
                rfc_emisor, rfc_receptor, metodo_pago, estado_sat
            FROM SatCfdis
            WHERE estado_sat = 'Cancelado'
              AND fecha_emision >= ? AND fecha_emision <= ?
            ORDER BY fecha_emision ASC
        `, [fechaInicio, fechaFin]);

        // ─── CÁLCULOS FISCALES ───
        // Separar ingresos cobrados PF y PM
        const emitidosPF = emitidosConsiderados.filter(c => c.es_persona_fisica || (!c.es_persona_moral && !c.es_persona_fisica));
        const emitidosPM = emitidosConsiderados.filter(c => c.es_persona_moral);

        const ingresosCobradosPF = emitidosPF.reduce((s, c) => s + c.subtotal, 0);
        const ingresosCobradosPM = emitidosPM.reduce((s, c) => s + c.subtotal, 0);
        const ingresosCobradosTotales = Math.round((ingresosCobradosPF + ingresosCobradosPM) * 100) / 100;

        // 1. ISR Federal (RESICO)
        const tasaIsrInfo = getIsrBracket(ingresosCobradosTotales);
        const isrCalculado = Math.round(ingresosCobradosTotales * tasaIsrInfo.tasa * 100) / 100;
        // Retención ISR por PM: 1.25% sobre ingresos cobrados a PM
        const isrRetenido = Math.round(ingresosCobradosPM * 0.0125 * 100) / 100;
        const isrFederalAPagar = Math.max(0, Math.round((isrCalculado - isrRetenido) * 100) / 100);

        // 2. Impuesto Estatal (Cedular)
        const tasaCedularInfo = getCedularBracket(ingresosCobradosTotales);
        const cedularCalculado = Math.round(ingresosCobradosTotales * tasaCedularInfo.tasa * 100) / 100;
        const cedularRetenido = emitidosConsiderados.reduce((s, c) => s + c.ret_cedular, 0);
        const impuestoEstatalAPagar = Math.max(0, Math.round((cedularCalculado - cedularRetenido) * 100) / 100);

        // 3. IVA
        const ivaEmitidos = Math.round(emitidosConsiderados.reduce((s, c) => s + c.iva, 0) * 100) / 100;
        const ivaRecibidos = Math.round(recibidosConsiderados.reduce((s, c) => s + c.iva, 0) * 100) / 100;
        const ivaAPagar = Math.round((ivaEmitidos - ivaRecibidos) * 100) / 100;

        // 4. Totales Generales
        const impuestoFederalTotal = Math.max(0, ivaAPagar) + isrFederalAPagar;
        const granTotalImpuestos = Math.round((impuestoFederalTotal + impuestoEstatalAPagar) * 100) / 100;

        return NextResponse.json({
            periodo: { anio, mes, fecha_inicio: fechaInicio, fecha_fin: fechaFin },
            resumen: {
                ingresosCobradosPF: Math.round(ingresosCobradosPF * 100) / 100,
                ingresosCobradosPM: Math.round(ingresosCobradosPM * 100) / 100,
                ingresosCobradosTotales,
                tasaIsrInfo,
                isrCalculado,
                isrRetenido,
                isrFederalAPagar,
                tasaCedularInfo,
                cedularCalculado,
                cedularRetenido: Math.round(cedularRetenido * 100) / 100,
                impuestoEstatalAPagar,
                ivaEmitidos,
                ivaRecibidos,
                ivaAPagar,
                impuestoFederalTotal: Math.round(impuestoFederalTotal * 100) / 100,
                granTotalImpuestos,
            },
            emitidos: emitidosConsiderados,
            recibidos: recibidosConsiderados,
            ppd_excluidos: ppdExcluidosRows,
            cancelados_excluidos: canceladosRows,
            conteo: {
                emitidos_pue: emitidosPueRows.length,
                emitidos_pagos_ppd: emitidosPagosRows.length,
                total_emitidos_considerados: emitidosConsiderados.length,
                recibidos_considerados: recibidosConsiderados.length,
                ppd_excluidos: ppdExcluidosRows.length,
                cancelados_excluidos: canceladosRows.length
            }
        });
    } catch (error: any) {
        console.error('[Tax Calculation Route] Error:', error);
        return NextResponse.json({ error: error.message || 'Error al calcular impuestos' }, { status: 500 });
    }
});
