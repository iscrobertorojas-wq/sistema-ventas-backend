import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { decrypt, decryptToString, encrypt } from '@/lib/encryption';
import { parseCfdiXml } from '@/lib/cfdi-parser';
import { detectCancellationInXml, checkSatCfdiStatus } from '@/lib/sat-status-checker';
import { saveCfdiPagos } from '@/lib/sat-pagos-helper';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import AdmZip from 'adm-zip';

export const dynamic = 'force-dynamic';

async function getEncryptedSetting(key: string): Promise<string | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT setting_value FROM Settings WHERE setting_key = ?',
        [key]
    );
    if (!rows || rows.length === 0 || !rows[0].setting_value) return null;
    return rows[0].setting_value;
}

export const POST = withAuth(async function POST(request) {
    try {
        const body = await request.json();
        const { id } = body;

        if (!id) {
            return NextResponse.json({ error: 'id es requerido' }, { status: 400 });
        }

        const [rows] = await pool.query<RowDataPacket[]>(
            'SELECT * FROM SatDownloadRequests WHERE id = ?',
            [id]
        );
        if (!rows || rows.length === 0) {
            return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 });
        }
        const solicitud = rows[0];

        if (solicitud.estado !== 'listo') {
            return NextResponse.json(
                { error: `La solicitud no está lista aún (estado: ${solicitud.estado})` },
                { status: 422 }
            );
        }

        let packageIds: string[] = [];
        try {
            packageIds = JSON.parse(solicitud.paquetes || '[]');
        } catch {
            return NextResponse.json({ error: 'No hay paquetes disponibles' }, { status: 422 });
        }

        // Leer y desencriptar FIEL
        const [encCer, encKey, encPass] = await Promise.all([
            getEncryptedSetting('fiel_cer'),
            getEncryptedSetting('fiel_key'),
            getEncryptedSetting('fiel_password'),
        ]);

        if (!encCer || !encKey || !encPass) {
            return NextResponse.json({ error: 'FIEL no configurada' }, { status: 422 });
        }

        const cerBuffer = decrypt(encCer);
        const keyBuffer = decrypt(encKey);
        const password = decryptToString(encPass);

        const { Fiel, FielRequestBuilder, Service } = await import('@nodecfdi/sat-ws-descarga-masiva');
        const { SafeWebClient } = await import('@/lib/sat-web-client');

        const fiel = Fiel.create(
            cerBuffer.toString('binary'),
            keyBuffer.toString('binary'),
            password
        );
        const webClient = new SafeWebClient(60000);
        const requestBuilder = new FielRequestBuilder(fiel);
        const service = new Service(requestBuilder, webClient);

        const tipo = solicitud.tipo === 'emitidos' ? 'emitido' : 'recibido';
        let cfdisSaved = 0;
        let cfdisSkipped = 0;
        let cfdisCanceladosActualizados = 0;
        let cfdisCanceladosNuevos = 0;

        // Descargar cada paquete
        for (const pkgId of packageIds) {
            const downloadResult = await service.download(pkgId);

            if (!downloadResult.getStatus().isAccepted()) {
                console.warn(`[SAT Download] Paquete ${pkgId} rechazado:`, downloadResult.getStatus().getMessage());
                continue;
            }

            const packageContent = downloadResult.getPackageContent(); // Base64
            const zipBuffer = Buffer.from(packageContent, 'base64');

            // Descomprimir el ZIP
            const zip = new AdmZip(zipBuffer);
            const entries = zip.getEntries();

            for (const entry of entries) {
                if (!entry.entryName.toLowerCase().endsWith('.xml')) continue;

                const xmlContent = entry.getData().toString('utf-8');

                // 1. Validar si el XML es un Acuse de Cancelación
                const acuseInfo = detectCancellationInXml(xmlContent);
                if (acuseInfo.isAcuse && acuseInfo.uuids.length > 0) {
                    for (const cancelUuid of acuseInfo.uuids) {
                        const [resAcuse]: any = await pool.query(
                            'UPDATE SatCfdis SET estado_sat = "Cancelado" WHERE uuid = ?',
                            [cancelUuid]
                        );
                        if (resAcuse?.affectedRows > 0) {
                            cfdisCanceladosActualizados++;
                        }
                    }
                    continue;
                }

                // 2. Parsear el CFDI
                const parsed = parseCfdiXml(xmlContent);
                if (!parsed || !parsed.uuid) {
                    console.warn('[SAT Download] XML sin UUID válido, saltando...');
                    continue;
                }

                // 3. Determinar estatus de cancelación
                let estadoSat: 'Vigente' | 'Cancelado' = acuseInfo.isCancelled ? 'Cancelado' : 'Vigente';

                // Si no se detectó cancelación directa en el texto del XML, consultar el servicio oficial del SAT
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

                // 4. Validar existencia previa en la BD
                const [existing] = await pool.query<RowDataPacket[]>(
                    'SELECT id, estado_sat FROM SatCfdis WHERE uuid = ?',
                    [parsed.uuid]
                );

                if (existing && existing.length > 0) {
                    const existingRow = existing[0];
                    // Si el XML descargado está cancelado y en la BD no lo estaba, actualizar estatus en la BD
                    if (estadoSat === 'Cancelado' && existingRow.estado_sat !== 'Cancelado') {
                        await pool.query(
                            'UPDATE SatCfdis SET estado_sat = "Cancelado" WHERE id = ?',
                            [existingRow.id]
                        );
                        cfdisCanceladosActualizados++;
                    } else if (!existingRow.estado_sat) {
                        await pool.query(
                            'UPDATE SatCfdis SET estado_sat = "Vigente" WHERE id = ?',
                            [existingRow.id]
                        );
                    }

                    // Si es un comprobante de pago, asegurar que sus relaciones queden guardadas en SatCfdiPagos
                    if (parsed.pagos && parsed.pagos.length > 0) {
                        await saveCfdiPagos(pool, existingRow.id, parsed.uuid, parsed.pagos);
                    }

                    cfdisSkipped++;
                    continue;
                }

                // 5. En caso de no existir previamente en la BD:
                // Se descarga y guarda de todas formas con su estatus ('Cancelado' o 'Vigente')
                const xmlEncrypted = encrypt(xmlContent);

                const [insertResult] = await pool.query<ResultSetHeader>(
                    `INSERT INTO SatCfdis 
                     (request_id, uuid, tipo, rfc_emisor, nombre_emisor, rfc_receptor, nombre_receptor,
                      fecha_emision, fecha_pago, subtotal, iva, ret_iva, ret_isr, ret_cedular, total, 
                      moneda, tipo_cfdi, metodo_pago, forma_pago, uso_cfdi, estado_sat, xml_content)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        id,
                        parsed.uuid,
                        tipo,
                        parsed.rfc_emisor || '',
                        parsed.nombre_emisor || null,
                        parsed.rfc_receptor || '',
                        parsed.nombre_receptor || null,
                        parsed.fecha_emision || null,
                        parsed.fecha_pago || null,
                        parsed.subtotal || 0,
                        parsed.iva || 0,
                        parsed.ret_iva || 0,
                        parsed.ret_isr || 0,
                        parsed.ret_cedular || 0,
                        parsed.total || 0,
                        parsed.moneda || 'MXN',
                        parsed.tipo_cfdi || null,
                        parsed.metodo_pago || null,
                        parsed.forma_pago || null,
                        parsed.uso_cfdi || null,
                        estadoSat,
                        xmlEncrypted
                    ]
                );

                const newCfdiId = insertResult.insertId;

                // Guardar desglose de pagos si aplica
                if (parsed.pagos && parsed.pagos.length > 0) {
                    await saveCfdiPagos(pool, newCfdiId, parsed.uuid, parsed.pagos);
                }

                cfdisSaved++;
                if (estadoSat === 'Cancelado') {
                    cfdisCanceladosNuevos++;
                }
            }
        }

        // Actualizar estado a descargado
        await pool.query(
            "UPDATE SatDownloadRequests SET estado = 'descargado' WHERE id = ?",
            [id]
        );

        return NextResponse.json({
            message: 'Descarga completada',
            estado: 'descargado',
            cfdis_nuevos: cfdisSaved,
            cfdis_duplicados: cfdisSkipped,
            cfdis_cancelados_actualizados: cfdisCanceladosActualizados,
            cfdis_cancelados_nuevos: cfdisCanceladosNuevos
        });

    } catch (error: any) {
        console.error('[SAT Download] Error:', error);
        return NextResponse.json({ error: error.message || 'Error interno del servidor' }, { status: 500 });
    }
});
