import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { decrypt, decryptToString } from '@/lib/encryption';
import { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';

// Helper: lee un setting encriptado de la BD
async function getEncryptedSetting(key: string): Promise<string | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT setting_value FROM Settings WHERE setting_key = ?',
        [key]
    );
    if (!rows || rows.length === 0 || !rows[0].setting_value) return null;
    return rows[0].setting_value;
}

// Helper: obtiene la fecha y hora actual en la zona horaria de México (America/Mexico_City)
// aplicando un margen de seguridad de 2 minutos para evitar cualquier rechazo del SAT por desfase de reloj.
function getMexicoDateTime(): { todayDateStr: string; safeTimeStr: string } {
    const d = new Date();
    // Restamos 2 minutos por seguridad para que el SAT nunca considere la fecha/hora en el futuro
    const dSafe = new Date(d.getTime() - 2 * 60 * 1000);

    const formatterDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const todayDateStr = formatterDate.format(dSafe); // 'YYYY-MM-DD'

    const formatterTime = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Mexico_City',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const safeTimeStr = formatterTime.format(dSafe); // 'HH:mm:ss'

    return { todayDateStr, safeTimeStr };
}

export const POST = withAuth(async function POST(request) {
    try {
        const body = await request.json();
        const { tipo, fecha_inicio, fecha_fin } = body;

        if (!tipo || !fecha_inicio || !fecha_fin) {
            return NextResponse.json({ error: 'tipo, fecha_inicio y fecha_fin son requeridos' }, { status: 400 });
        }
        if (!['emitidos', 'recibidos', 'ambos'].includes(tipo)) {
            return NextResponse.json({ error: 'tipo debe ser "emitidos", "recibidos" o "ambos"' }, { status: 400 });
        }

        // 1. Leer archivos FIEL y RFC desde Settings (encriptados)
        const [encCer, encKey, encPass, rfcSetting] = await Promise.all([
            getEncryptedSetting('fiel_cer'),
            getEncryptedSetting('fiel_key'),
            getEncryptedSetting('fiel_password'),
            getEncryptedSetting('rfc_contribuyente'),
        ]);

        if (!encCer || !encKey || !encPass) {
            return NextResponse.json(
                { error: 'La FIEL no está configurada. Ve a Configuración y sube tu e.firma.' },
                { status: 422 }
            );
        }
        if (!rfcSetting) {
            return NextResponse.json(
                { error: 'El RFC del contribuyente no está configurado.' },
                { status: 422 }
            );
        }

        // 2. Desencriptar FIEL
        const cerBuffer = decrypt(encCer);
        const keyBuffer = decrypt(encKey);
        const password = decryptToString(encPass);

        // 3. Usar la librería @nodecfdi (ESM) con import dinámico
        const { Fiel, HttpsWebClient, FielRequestBuilder, Service, QueryParameters, DateTimePeriod, DownloadType, RequestType, DocumentStatus, SoapFaultError, WebClientException } = await import('@nodecfdi/sat-ws-descarga-masiva');

        const fiel = Fiel.create(
            cerBuffer.toString('binary'),
            keyBuffer.toString('binary'),
            password
        );

        if (!fiel.isValid()) {
            return NextResponse.json(
                { error: 'La FIEL es inválida o ha caducado. Verifica los archivos en Configuración.' },
                { status: 422 }
            );
        }

        const { SafeWebClient } = await import('@/lib/sat-web-client');
        const webClient = new SafeWebClient(60000);
        const requestBuilder = new FielRequestBuilder(fiel);
        const service = new Service(requestBuilder, webClient);

        // 4. Determinar tipos a solicitar (emitidos, recibidos o ambos)
        const tiposAProcesar: ('emitidos' | 'recibidos')[] =
            tipo === 'ambos' ? ['emitidos', 'recibidos'] : [tipo as 'emitidos' | 'recibidos'];

        // 5. Ajustar fechas para cumplir estrictamente con las reglas del Web Service del SAT:
        // El SAT rechaza con "XML Mal Formado: La solicitud de descarga no es válida. Fecha final invalida"
        // si la fecha final excede la fecha y hora actual en México.
        const { todayDateStr, safeTimeStr } = getMexicoDateTime();

        let cleanInicio = String(fecha_inicio).trim();
        let cleanFin = String(fecha_fin).trim();

        // Si la fecha fin es posterior a hoy en México, toparla a hoy
        if (cleanFin > todayDateStr) {
            cleanFin = todayDateStr;
        }
        if (cleanInicio > cleanFin) {
            cleanInicio = cleanFin;
        }

        // Si la fecha fin es hoy en México, no podemos enviar 23:59:59 porque aún no transcurre el día;
        // usamos la hora actual en México con margen seguro.
        // Si la fecha fin es de un día anterior, enviamos 23:59:59 porque ese día ya concluyó.
        const horaFin = (cleanFin === todayDateStr) ? safeTimeStr : '23:59:59';
        const horaInicio = '00:00:00';

        console.log(`[SAT Request] Rango ajustado para SAT: ${cleanInicio}T${horaInicio} a ${cleanFin}T${horaFin} (Hoy MX: ${todayDateStr} ${safeTimeStr})`);

        const period = DateTimePeriod.createFromValues(
            `${cleanInicio}T${horaInicio}`,
            `${cleanFin}T${horaFin}`
        );

        const resultados: any[] = [];
        const errores: string[] = [];

        for (const tipoItem of tiposAProcesar) {
            try {
                const downloadType = tipoItem === 'emitidos' ? new DownloadType('issued') : new DownloadType('received');

                // Para recibidos, el SAT rechaza si no es 'active'. Para emitidos, 'undefined' permite descargar tanto vigentes como cancelados.
                const documentStatus = tipoItem === 'emitidos'
                    ? new DocumentStatus('undefined')
                    : new DocumentStatus('active');

                const queryParams = QueryParameters.create(period)
                    .withDownloadType(downloadType)
                    .withRequestType(new RequestType('xml'))
                    .withDocumentStatus(documentStatus);

                const queryResult = await service.query(queryParams);

                if (!queryResult.getStatus().isAccepted()) {
                    const msg = queryResult.getStatus().getMessage() || 'El SAT rechazó la solicitud';
                    await pool.query(
                        `INSERT INTO SatDownloadRequests (tipo, fecha_inicio, fecha_fin, estado, mensaje_error)
                         VALUES (?, ?, ?, 'error', ?)`,
                        [tipoItem, cleanInicio, cleanFin, msg]
                    );
                    errores.push(`${tipoItem}: ${msg}`);
                    resultados.push({ tipo: tipoItem, estado: 'error', error: msg });
                } else {
                    const satRequestId = queryResult.getRequestId();
                    const [insertResult]: any = await pool.query(
                        `INSERT INTO SatDownloadRequests (request_id, tipo, fecha_inicio, fecha_fin, estado)
                         VALUES (?, ?, ?, ?, 'pendiente')`,
                        [satRequestId, tipoItem, cleanInicio, cleanFin]
                    );
                    resultados.push({
                        id: insertResult.insertId,
                        tipo: tipoItem,
                        request_id: satRequestId,
                        estado: 'pendiente'
                    });
                }
            } catch (err: any) {
                console.error(`[SAT Request] Error procesando ${tipoItem}:`, err);
                // Extraer mensaje limpio según el tipo de error de la librería
                let errMsg: string;
                if (err instanceof SoapFaultError) {
                    errMsg = err.getFault()?.getMessage?.() || err.message || 'Error SOAP del SAT';
                } else if (err instanceof WebClientException) {
                    errMsg = err.message || 'Error de comunicación con el SAT';
                } else {
                    errMsg = err.message || 'Error de conexión';
                }
                errores.push(`${tipoItem}: ${errMsg}`);
            }
        }

        if (resultados.filter(r => r.estado === 'pendiente').length === 0) {
            return NextResponse.json({
                error: `No se pudo iniciar la descarga con el SAT: ${errores.join('; ')}`
            }, { status: 502 });
        }

        return NextResponse.json({
            message: tipo === 'ambos' 
                ? 'Solicitudes enviadas al SAT para Emitidos y Recibidos' 
                : `Solicitud enviada al SAT para ${tipo}`,
            resultados
        });

    } catch (error: any) {
        console.error('[SAT Request] Error:', error);
        return NextResponse.json({ error: error.message || 'Error interno del servidor' }, { status: 500 });
    }
});
