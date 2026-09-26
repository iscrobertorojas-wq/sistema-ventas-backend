import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { encrypt } from '@/lib/encryption';
import { parseCfdiXml } from '@/lib/cfdi-parser';
import { detectCancellationInXml, checkSatCfdiStatus } from '@/lib/sat-status-checker';
import { saveCfdiPagos } from '@/lib/sat-pagos-helper';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import AdmZip from 'adm-zip';

export const dynamic = 'force-dynamic';

async function getUserRfc(): Promise<string | null> {
    try {
        const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT setting_value FROM Settings 
             WHERE setting_key IN ('rfc_contribuyente', 'fiel_rfc') 
               AND setting_value IS NOT NULL AND setting_value != ''
             LIMIT 1`
        );
        return rows?.[0]?.setting_value || null;
    } catch {
        return null;
    }
}

async function processXmlItem(
    xmlText: string,
    userRfc: string | null
): Promise<{
    status: 'guardado' | 'duplicado' | 'invalido' | 'cancelado_actualizado';
    isCancelado: boolean;
}> {
    // 1. Validar si es un Acuse de Cancelación
    const acuseInfo = detectCancellationInXml(xmlText);
    if (acuseInfo.isAcuse && acuseInfo.uuids.length > 0) {
        let updatedCount = 0;
        for (const cancelUuid of acuseInfo.uuids) {
            const [resAcuse]: any = await pool.query(
                'UPDATE SatCfdis SET estado_sat = "Cancelado" WHERE uuid = ?',
                [cancelUuid]
            );
            if (resAcuse?.affectedRows > 0) {
                updatedCount++;
            }
        }
        if (updatedCount > 0) {
            return { status: 'cancelado_actualizado', isCancelado: true };
        }
        return { status: 'duplicado', isCancelado: true };
    }

    // 2. Parsear el CFDI
    const parsed = parseCfdiXml(xmlText, userRfc);
    if (!parsed || !parsed.uuid) {
        return { status: 'invalido', isCancelado: false };
    }

    // 3. Determinar estatus de cancelación
    let estadoSat: 'Vigente' | 'Cancelado' = acuseInfo.isCancelled ? 'Cancelado' : 'Vigente';
    if (estadoSat !== 'Cancelado') {
        const satOnlineStatus = await checkSatCfdiStatus(
            parsed.uuid,
            parsed.rfc_emisor,
            parsed.rfc_receptor,
            parsed.total_original !== undefined ? parsed.total_original : parsed.total,
            parsed.sello
        );
        if (satOnlineStatus === 'Cancelado') {
            estadoSat = 'Cancelado';
        }
    }

    // 4. Validar existencia en la BD
    const [existing] = await pool.query<RowDataPacket[]>(
        'SELECT id, estado_sat FROM SatCfdis WHERE uuid = ?',
        [parsed.uuid]
    );

    if (existing && existing.length > 0) {
        const existingRow = existing[0];
        let wasUpdated = false;

        if (estadoSat === 'Cancelado' && existingRow.estado_sat !== 'Cancelado') {
            await pool.query(
                'UPDATE SatCfdis SET estado_sat = "Cancelado" WHERE id = ?',
                [existingRow.id]
            );
            wasUpdated = true;
        } else if (!existingRow.estado_sat) {
            await pool.query(
                'UPDATE SatCfdis SET estado_sat = "Vigente" WHERE id = ?',
                [existingRow.id]
            );
        }

        // Si contiene complementos de pago, guardarlos en SatCfdiPagos
        if (parsed.pagos && parsed.pagos.length > 0) {
            await saveCfdiPagos(pool, existingRow.id, parsed.uuid, parsed.pagos);
        }

        return {
            status: wasUpdated ? 'cancelado_actualizado' : 'duplicado',
            isCancelado: estadoSat === 'Cancelado'
        };
    }

    // 5. Insertar nuevo CFDI con su estado correspondiente
    const xmlEncrypted = encrypt(xmlText);

    const [insertResult] = await pool.query<ResultSetHeader>(
        `INSERT INTO SatCfdis 
         (request_id, uuid, tipo, rfc_emisor, nombre_emisor, rfc_receptor, nombre_receptor,
          fecha_emision, fecha_pago, subtotal, iva, ret_iva, ret_isr, ret_cedular, total, 
          moneda, tipo_cfdi, metodo_pago, forma_pago, uso_cfdi, estado_sat, xml_content)
         VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            parsed.uuid,
            parsed.tipo,
            parsed.rfc_emisor,
            parsed.nombre_emisor,
            parsed.rfc_receptor,
            parsed.nombre_receptor,
            parsed.fecha_emision,
            parsed.fecha_pago || null,
            parsed.subtotal,
            parsed.iva,
            parsed.ret_iva,
            parsed.ret_isr,
            parsed.ret_cedular,
            parsed.total,
            parsed.moneda,
            parsed.tipo_cfdi,
            parsed.metodo_pago,
            parsed.forma_pago,
            parsed.uso_cfdi,
            estadoSat,
            xmlEncrypted
        ]
    );

    const newId = insertResult.insertId;
    if (parsed.pagos && parsed.pagos.length > 0) {
        await saveCfdiPagos(pool, newId, parsed.uuid, parsed.pagos);
    }

    return {
        status: 'guardado',
        isCancelado: estadoSat === 'Cancelado'
    };
}

export const POST = withAuth(async function POST(request) {
    try {
        const formData = await request.formData();
        const files = formData.getAll('files') as File[];

        if (!files || files.length === 0) {
            const singleFile = formData.get('file') as File | null;
            if (singleFile) {
                files.push(singleFile);
            }
        }

        if (files.length === 0) {
            return NextResponse.json(
                { error: 'No se enviaron archivos para procesar' },
                { status: 400 }
            );
        }

        const userRfc = await getUserRfc();

        let totalProcesados = 0;
        let guardados = 0;
        let duplicados = 0;
        let canceladosActualizados = 0;
        let canceladosNuevos = 0;
        let invalidos = 0;
        const errores: string[] = [];

        for (const file of files) {
            const fileName = file.name.toLowerCase();
            const buffer = Buffer.from(await file.arrayBuffer());

            // 1. Archivo ZIP
            if (fileName.endsWith('.zip')) {
                try {
                    const zip = new AdmZip(buffer);
                    const entries = zip.getEntries();

                    for (const entry of entries) {
                        if (entry.isDirectory || !entry.entryName.toLowerCase().endsWith('.xml')) {
                            continue;
                        }

                        totalProcesados++;
                        const xmlText = entry.getData().toString('utf-8');
                        const result = await processXmlItem(xmlText, userRfc);

                        if (result.status === 'guardado') {
                            guardados++;
                            if (result.isCancelado) canceladosNuevos++;
                        } else if (result.status === 'cancelado_actualizado') {
                            canceladosActualizados++;
                            duplicados++;
                        } else if (result.status === 'duplicado') {
                            duplicados++;
                        } else {
                            invalidos++;
                        }
                    }
                } catch (zipErr: any) {
                    errores.push(`Error al leer archivo ZIP (${file.name}): ${zipErr.message}`);
                }
            } 
            // 2. Archivo XML individual
            else if (fileName.endsWith('.xml')) {
                totalProcesados++;
                try {
                    const xmlText = buffer.toString('utf-8');
                    const result = await processXmlItem(xmlText, userRfc);

                    if (result.status === 'guardado') {
                        guardados++;
                        if (result.isCancelado) canceladosNuevos++;
                    } else if (result.status === 'cancelado_actualizado') {
                        canceladosActualizados++;
                        duplicados++;
                    } else if (result.status === 'duplicado') {
                        duplicados++;
                    } else {
                        invalidos++;
                    }
                } catch (xmlErr: any) {
                    errores.push(`Error al procesar XML (${file.name}): ${xmlErr.message}`);
                }
            } else {
                errores.push(`Formato no soportado: ${file.name} (sólo .xml y .zip)`);
            }
        }

        let message = `Proceso finalizado: ${guardados} CFDIs nuevos guardados (${duplicados} omitidos por ya existir).`;
        if (canceladosActualizados > 0) {
            message += ` Se actualizaron ${canceladosActualizados} CFDIs a estatus Cancelado.`;
        }

        return NextResponse.json({
            success: true,
            total_procesados: totalProcesados,
            guardados,
            duplicados,
            cancelados_actualizados: canceladosActualizados,
            cancelados_nuevos: canceladosNuevos,
            invalidos,
            errores: errores.length > 0 ? errores : undefined,
            message
        });

    } catch (error: any) {
        console.error('[SAT Upload] Error general:', error);
        return NextResponse.json({ error: error.message || 'Error interno al procesar archivos' }, { status: 500 });
    }
});
