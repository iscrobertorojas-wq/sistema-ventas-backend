import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { decrypt, decryptToString, encrypt } from '@/lib/encryption';
import { RowDataPacket } from 'mysql2';
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

import { parseCfdiXml } from '@/lib/cfdi-parser';


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
                const parsed = parseCfdiXml(xmlContent);

                if (!parsed || !parsed.uuid) {
                    console.warn('[SAT Download] XML sin UUID válido, saltando...');
                    continue;
                }

                // Validar que el CFDI no exista previamente en la base de datos
                const [existing] = await pool.query<RowDataPacket[]>(
                    'SELECT id FROM SatCfdis WHERE uuid = ?',
                    [parsed.uuid]
                );

                if (existing && existing.length > 0) {
                    cfdisSkipped++;
                    continue;
                }

                // Encriptar el XML antes de almacenar en BD
                const xmlEncrypted = encrypt(xmlContent);

                await pool.query(
                    `INSERT INTO SatCfdis 
                     (request_id, uuid, tipo, rfc_emisor, nombre_emisor, rfc_receptor, nombre_receptor,
                      fecha_emision, subtotal, iva, ret_iva, ret_isr, ret_cedular, total, moneda, tipo_cfdi, metodo_pago, forma_pago, uso_cfdi, xml_content)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        id,
                        parsed.uuid,
                        tipo,
                        parsed.rfc_emisor || '',
                        parsed.nombre_emisor || null,
                        parsed.rfc_receptor || '',
                        parsed.nombre_receptor || null,
                        parsed.fecha_emision || null,
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
                        xmlEncrypted
                    ]
                );
                cfdisSaved++;
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
            cfdis_duplicados: cfdisSkipped
        });

    } catch (error: any) {
        console.error('[SAT Download] Error:', error);
        return NextResponse.json({ error: error.message || 'Error interno del servidor' }, { status: 500 });
    }
});
