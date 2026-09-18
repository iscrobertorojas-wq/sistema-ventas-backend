import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { decrypt, decryptToString } from '@/lib/encryption';
import { RowDataPacket } from 'mysql2';

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
    let requestId: number | null = null; // capturado pronto para usar en catch
    try {
        const body = await request.json();
        const { id } = body; // ID interno en nuestra BD
        requestId = id ?? null;

        if (!id) {
            return NextResponse.json({ error: 'id es requerido' }, { status: 400 });
        }

        // 1. Obtener la solicitud de la BD
        const [rows] = await pool.query<RowDataPacket[]>(
            'SELECT * FROM SatDownloadRequests WHERE id = ?',
            [id]
        );
        if (!rows || rows.length === 0) {
            return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 });
        }
        const solicitud = rows[0];

        if (!solicitud.request_id) {
            return NextResponse.json({ error: 'Esta solicitud no tiene ID del SAT asociado' }, { status: 422 });
        }
        if (solicitud.estado === 'descargado') {
            return NextResponse.json({ message: 'Ya descargado', estado: 'descargado' });
        }

        // 2. Leer y desencriptar FIEL
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

        // 3. Conectar al SAT
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

        // 4. Verificar estado
        await pool.query(
            "UPDATE SatDownloadRequests SET estado = 'verificando' WHERE id = ?",
            [id]
        );

        const verifyResult = await service.verify(solicitud.request_id);
        const status = verifyResult.getStatus();
        const statusRequest = verifyResult.getStatusRequest();
        const codeRequest = verifyResult.getCodeRequest();

        const isFinished = statusRequest.isTypeOf('Finished');
        const isFailure = statusRequest.isTypeOf('Failure') || statusRequest.isTypeOf('Rejected') || statusRequest.isTypeOf('Expired');
        const totalCfdis = verifyResult.getNumberCfdis();
        const packageIds = verifyResult.getPackageIds();

        let nuevoEstado: string;
        let mensajeError: string | null = null;

        if (!status.isAccepted()) {
            nuevoEstado = 'error';
            mensajeError = status.getMessage() || 'Error de autenticación con el SAT';
        } else if (isFinished && packageIds.length > 0) {
            nuevoEstado = 'listo';
        } else if (isFinished && packageIds.length === 0) {
            nuevoEstado = 'vacio';
            mensajeError = 'No se encontraron CFDIs para los filtros y fechas seleccionados';
        } else if (isFailure) {
            nuevoEstado = 'error';
            const codeMsg = codeRequest.getMessage?.() || '';
            const reqEntry = statusRequest.getEntryId?.() || '';
            mensajeError = `SAT: ${codeMsg || reqEntry || 'Solicitud fallida'}`;
        } else {
            nuevoEstado = 'pendiente'; // Aún en proceso
        }

        await pool.query(
            `UPDATE SatDownloadRequests 
             SET estado = ?, paquetes = ?, total_cfdis = ?, mensaje_error = ?
             WHERE id = ?`,
            [
                nuevoEstado,
                packageIds.length > 0 ? JSON.stringify(packageIds) : null,
                totalCfdis,
                mensajeError,
                id
            ]
        );

        return NextResponse.json({
            id,
            estado: nuevoEstado,
            total_cfdis: totalCfdis,
            paquetes: packageIds,
            mensaje_error: mensajeError
        });

    } catch (error: any) {
        console.error('[SAT Verify] Error:', error);

        // Si la solicitud quedó en estado 'verificando', revertir a 'pendiente'
        if (requestId) {
            try {
                await pool.query(
                    "UPDATE SatDownloadRequests SET estado = 'pendiente' WHERE id = ? AND estado = 'verificando'",
                    [requestId]
                );
            } catch (_) { /* ignorar fallo de rollback */ }
        }

        let mensajeError: string;
        // SoapFaultError y WebClientException son importadas condicionalmente; usamos duck-typing como fallback
        if (typeof error.getFault === 'function') {
            mensajeError = error.getFault()?.getMessage?.() || error.message || 'Error SOAP del SAT';
        } else {
            mensajeError = error.message || 'Error interno del servidor';
        }
        return NextResponse.json({ error: mensajeError }, { status: 500 });
    }
});
