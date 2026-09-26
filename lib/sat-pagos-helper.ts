import { ParsedPayment } from '@/lib/cfdi-parser';
import { RowDataPacket } from 'mysql2';

/**
 * Guarda las relaciones de complementos de pago en SatCfdiPagos
 */
export async function saveCfdiPagos(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    cfdiId: number,
    cfdiUuid: string,
    pagos: ParsedPayment[]
): Promise<number> {
    let saved = 0;
    for (const p of pagos) {
        for (const doc of p.doctos_relacionados) {
            if (!doc.id_documento) continue;

            const [existing] = await db.query(
                `SELECT id FROM SatCfdiPagos 
                 WHERE cfdi_pago_uuid = ? AND docto_relacionado_uuid = ? AND num_parcialidad = ? 
                 LIMIT 1`,
                [cfdiUuid, doc.id_documento, doc.num_parcialidad]
            );

            if (!existing || (existing as RowDataPacket[]).length === 0) {
                await db.query(
                    `INSERT INTO SatCfdiPagos
                     (cfdi_pago_id, cfdi_pago_uuid, docto_relacionado_uuid, num_parcialidad, fecha_pago,
                      forma_pago, moneda, monto_pagado, subtotal, iva, ret_iva, ret_isr, ret_cedular)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        cfdiId,
                        cfdiUuid,
                        doc.id_documento,
                        doc.num_parcialidad,
                        p.fecha_pago || new Date(),
                        p.forma_pago || null,
                        doc.moneda_dr || p.moneda || 'MXN',
                        doc.imp_pagado || 0,
                        doc.subtotal || 0,
                        doc.iva || 0,
                        doc.ret_iva || 0,
                        doc.ret_isr || 0,
                        doc.ret_cedular || 0
                    ]
                );
                saved++;
            }
        }
    }
    return saved;
}
