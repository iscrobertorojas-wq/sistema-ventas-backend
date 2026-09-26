import https from 'https';

/**
 * Extrae todos los UUIDs cancelados presentes en un Acuse de Cancelación del SAT.
 */
export function detectAllCancellationsInAcuse(xmlStr: string): string[] {
    const uuids: string[] = [];
    if (!xmlStr) return uuids;

    const isAcuse = xmlStr.includes('cancelacfd.sat.gob.mx') ||
                    /<(?:[a-zA-Z0-9]+:)?Acuse\b/i.test(xmlStr) ||
                    /<CancelaCFD/i.test(xmlStr);

    if (!isAcuse) return uuids;

    // Extraer de etiquetas <UUID>...</UUID>
    const regex1 = /<(?:[a-zA-Z0-9]+:)?UUID>([0-9a-fA-F-]{36})<\/(?:[a-zA-Z0-9]+:)?UUID>/gi;
    let m: RegExpExecArray | null;
    while ((m = regex1.exec(xmlStr)) !== null) {
        const u = m[1].trim().toUpperCase();
        if (!uuids.includes(u)) uuids.push(u);
    }

    // Extraer de atributos UUID="..."
    const regex2 = /\bUUID="([0-9a-fA-F-]{36})"/gi;
    while ((m = regex2.exec(xmlStr)) !== null) {
        const u = m[1].trim().toUpperCase();
        if (!uuids.includes(u)) uuids.push(u);
    }

    return uuids;
}

/**
 * Verifica si un contenido XML corresponde a un Acuse de Cancelación
 * o tiene información de estatus de cancelación explícita en su texto.
 */
export function detectCancellationInXml(xmlStr: string): {
    isCancelled: boolean;
    isAcuse: boolean;
    uuid: string | null;
    uuids: string[];
} {
    if (!xmlStr) return { isCancelled: false, isAcuse: false, uuid: null, uuids: [] };

    // 1. Detectar Acuse de Cancelación del SAT
    const allAcuseUuids = detectAllCancellationsInAcuse(xmlStr);
    if (allAcuseUuids.length > 0) {
        return {
            isCancelled: true,
            isAcuse: true,
            uuid: allAcuseUuids[0],
            uuids: allAcuseUuids
        };
    }

    // 2. Detectar etiquetas o atributos explícitos de estado cancelado en el XML
    const cancelledTags = [
        /Estado\s*=\s*["']Cancelado["']/i,
        /Estatus\s*=\s*["']Cancelado["']/i,
        /EstatusCFDI\s*=\s*["']Cancelado["']/i,
        /EstatusDocumento\s*=\s*["']Cancelado["']/i,
        /<EstatusCancelacion>[^<]*Cancelado[^<]*<\/EstatusCancelacion>/i,
        /<Estado>[^<]*Cancelado[^<]*<\/Estado>/i,
    ];

    for (const regex of cancelledTags) {
        if (regex.test(xmlStr)) {
            const uuidMatch = xmlStr.match(/TimbreFiscalDigital[^>]+UUID="([^"]+)"/i) ||
                              xmlStr.match(/UUID="([0-9a-fA-F-]{36})"/i);
            const uuid = uuidMatch ? uuidMatch[1].toUpperCase() : null;
            return { isCancelled: true, isAcuse: false, uuid, uuids: uuid ? [uuid] : [] };
        }
    }

    return { isCancelled: false, isAcuse: false, uuid: null, uuids: [] };
}

/**
 * Ejecuta una petición SOAP de consulta al Web Service público del SAT.
 */
function querySatSoap(expression: string, timeoutMs: number = 7000): Promise<string> {
    const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soapenv:Header/>
  <soapenv:Body>
    <tem:Consulta>
      <tem:expresionImpresa><![CDATA[${expression}]]></tem:expresionImpresa>
    </tem:Consulta>
  </soapenv:Body>
</soapenv:Envelope>`;

    const agent = new https.Agent({
        minVersion: 'TLSv1.2',
        rejectUnauthorized: false,
    });

    return new Promise<string>((resolve, reject) => {
        const req = https.request(
            'https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc',
            {
                method: 'POST',
                agent,
                timeout: timeoutMs,
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                    'SOAPAction': 'http://tempuri.org/IConsultaCFDIService/Consulta',
                    'Content-Length': Buffer.byteLength(soapEnvelope, 'utf-8'),
                }
            },
            (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => resolve(data));
            }
        );

        req.on('error', err => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('SAT ConsultaCFDIService timeout'));
        });

        req.write(soapEnvelope);
        req.end();
    });
}

function parseSatStatusFromXml(resultXml: string): 'Vigente' | 'Cancelado' | 'NoEncontrado' | null {
    if (!resultXml) return null;

    const estadoMatch = resultXml.match(/<(?:[a-zA-Z0-9]+:)?Estado>([^<]+)<\/(?:[a-zA-Z0-9]+:)?Estado>/i);
    const estatusCancMatch = resultXml.match(/<(?:[a-zA-Z0-9]+:)?EstatusCancelacion>([^<]+)<\/(?:[a-zA-Z0-9]+:)?EstatusCancelacion>/i);

    const estado = estadoMatch ? estadoMatch[1].trim() : '';
    const estatusCanc = estatusCancMatch ? estatusCancMatch[1].trim() : '';

    if (/^Cancelado$/i.test(estado) || /Cancelado/i.test(estatusCanc)) {
        return 'Cancelado';
    }
    if (/^Vigente$/i.test(estado)) {
        return 'Vigente';
    }
    if (/No\s*Encontrado/i.test(estado) || /N\s*-\s*602/i.test(resultXml)) {
        return 'NoEncontrado';
    }

    return null;
}

/**
 * Consulta el estado oficial de un CFDI directamente en el Web Service del SAT.
 * Servicio público: https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc
 * No requiere autenticación ni FIEL.
 */
export async function checkSatCfdiStatus(
    uuid: string,
    rfcEmisor: string,
    rfcReceptor: string,
    total: number,
    sello?: string | null,
    timeoutMs: number = 7000
): Promise<'Vigente' | 'Cancelado' | 'NoEncontrado' | null> {
    if (!uuid || !rfcEmisor || !rfcReceptor) return null;

    try {
        const cleanUuid = uuid.trim().toUpperCase();
        const cleanEmisor = rfcEmisor.trim().toUpperCase();
        const cleanReceptor = rfcReceptor.trim().toUpperCase();
        const formattedTotal = Number(total || 0).toFixed(6);
        const last8Sello = (sello && sello.trim().length >= 8) ? sello.trim().slice(-8) : null;

        // 1. Intento estándar (con 6 decimales)
        const expr1 = `?re=${cleanEmisor}&rr=${cleanReceptor}&tt=${formattedTotal}&id=${cleanUuid}`;
        const resXml1 = await querySatSoap(expr1, timeoutMs);
        let status = parseSatStatusFromXml(resXml1);

        if (status === 'Vigente' || status === 'Cancelado') {
            return status;
        }

        // 2. Si no fue concluyente y tenemos los últimos 8 caracteres del sello (CFDI 4.0), intentar con fe=
        if (last8Sello) {
            const exprFe = `?re=${cleanEmisor}&rr=${cleanReceptor}&tt=${formattedTotal}&id=${cleanUuid}&fe=${last8Sello}`;
            const resXmlFe = await querySatSoap(exprFe, timeoutMs);
            status = parseSatStatusFromXml(resXmlFe);
            if (status === 'Vigente' || status === 'Cancelado') {
                return status;
            }
        }

        // 3. Si el total es 0 o es un CFDI de tipo pago, probar con tt=0.000000 o tt=0
        if (total === 0 || formattedTotal === '0.000000') {
            const exprZero = `?re=${cleanEmisor}&rr=${cleanReceptor}&tt=0&id=${cleanUuid}`;
            const resXmlZero = await querySatSoap(exprZero, timeoutMs);
            status = parseSatStatusFromXml(resXmlZero);
            if (status === 'Vigente' || status === 'Cancelado') {
                return status;
            }
        }

        return status;
    } catch (err: unknown) {
        console.warn(`[SAT Status] No se pudo verificar UUID ${uuid}: ${(err as Error).message}`);
        return null;
    }
}
