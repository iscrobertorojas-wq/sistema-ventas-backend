import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { encrypt } from '@/lib/encryption';
import { parseCfdiXml } from '@/lib/cfdi-parser';
import { RowDataPacket } from 'mysql2';
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

export const POST = withAuth(async function POST(request) {
    try {
        const formData = await request.formData();
        const files = formData.getAll('files') as File[];

        if (!files || files.length === 0) {
            // También revisar si se envió un único archivo bajo el nombre 'file'
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
        let invalidos = 0;
        const errores: string[] = [];

        for (const file of files) {
            const fileName = file.name.toLowerCase();
            const buffer = Buffer.from(await file.arrayBuffer());

            // 1. Si es un archivo ZIP
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
                        const parsed = parseCfdiXml(xmlText, userRfc);

                        if (!parsed || !parsed.uuid) {
                            invalidos++;
                            continue;
                        }

                        // Validar si el XML ya existe en la base de datos
                        const [existing] = await pool.query<RowDataPacket[]>(
                            'SELECT id FROM SatCfdis WHERE uuid = ?',
                            [parsed.uuid]
                        );

                        if (existing && existing.length > 0) {
                            duplicados++;
                            continue;
                        }

                        // Encriptar XML antes de guardar
                        const xmlEncrypted = encrypt(xmlText);

                        await pool.query(
                            `INSERT INTO SatCfdis 
                             (request_id, uuid, tipo, rfc_emisor, nombre_emisor, rfc_receptor, nombre_receptor,
                              fecha_emision, subtotal, iva, ret_iva, ret_isr, ret_cedular, total, moneda, tipo_cfdi, metodo_pago, forma_pago, uso_cfdi, xml_content)
                             VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                parsed.uuid,
                                parsed.tipo,
                                parsed.rfc_emisor,
                                parsed.nombre_emisor,
                                parsed.rfc_receptor,
                                parsed.nombre_receptor,
                                parsed.fecha_emision,
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
                                xmlEncrypted
                            ]
                        );

                        guardados++;
                    }
                } catch (zipErr: any) {
                    errores.push(`Error al leer archivo ZIP (${file.name}): ${zipErr.message}`);
                }
            } 
            // 2. Si es un archivo XML individual
            else if (fileName.endsWith('.xml')) {
                totalProcesados++;
                try {
                    const xmlText = buffer.toString('utf-8');
                    const parsed = parseCfdiXml(xmlText, userRfc);

                    if (!parsed || !parsed.uuid) {
                        invalidos++;
                        continue;
                    }

                    // Validar si el XML ya existe en la base de datos
                    const [existing] = await pool.query<RowDataPacket[]>(
                        'SELECT id FROM SatCfdis WHERE uuid = ?',
                        [parsed.uuid]
                    );

                    if (existing && existing.length > 0) {
                        duplicados++;
                        continue;
                    }

                    // Encriptar XML antes de guardar
                    const xmlEncrypted = encrypt(xmlText);

                    await pool.query(
                        `INSERT INTO SatCfdis 
                         (request_id, uuid, tipo, rfc_emisor, nombre_emisor, rfc_receptor, nombre_receptor,
                          fecha_emision, subtotal, iva, ret_iva, ret_isr, ret_cedular, total, moneda, tipo_cfdi, metodo_pago, forma_pago, uso_cfdi, xml_content)
                         VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            parsed.uuid,
                            parsed.tipo,
                            parsed.rfc_emisor,
                            parsed.nombre_emisor,
                            parsed.rfc_receptor,
                            parsed.nombre_receptor,
                            parsed.fecha_emision,
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
                            xmlEncrypted
                        ]
                    );

                    guardados++;
                } catch (xmlErr: any) {
                    errores.push(`Error al procesar XML (${file.name}): ${xmlErr.message}`);
                }
            } else {
                errores.push(`Formato no soportado: ${file.name} (sólo .xml y .zip)`);
            }
        }

        return NextResponse.json({
            success: true,
            total_procesados: totalProcesados,
            guardados,
            duplicados,
            invalidos,
            errores: errores.length > 0 ? errores : undefined,
            message: `Proceso finalizado: ${guardados} CFDIs nuevos guardados, ${duplicados} omitidos por ya existir.`
        });

    } catch (error: any) {
        console.error('[SAT Upload] Error general:', error);
        return NextResponse.json({ error: error.message || 'Error interno al procesar archivos' }, { status: 500 });
    }
});
