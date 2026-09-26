import https from 'https';

/**
 * Verifica si un contenido XML corresponde a un Acuse de Cancelación
 * o tiene información de estatus de cancelación.
 */
export function detectCancellationInXml(xmlStr: string): {
    isCancelled: boolean;
    isAcuse: boolean;
    uuid: string | null;
} {
    if (!xmlStr) return { isCancelled: false, isAcuse: false, uuid: null };

    // 1. Detectar Acuse de Cancelación del SAT
    const isAcuseMatch = xmlStr.includes('cancelacfd.sat.gob.mx') ||
                         /<(?:[a-zA-Z0-9]+:)?Acuse\b/i.test(xmlStr) ||
                         /<CancelaCFDIsResult/i.test(xmlStr);

    if (isAcuseMatch) {
        const uuidMatch = xmlStr.match(/<UUID>([0-9a-fA-F-]{36})<\/UUID>/i) ||
                          xmlStr.match(/UUID="([0-9a-fA-F-]{36})"/i);
        const uuid = uuidMatch ? uuidMatch[1].toUpperCase() : null;

        // Estatus 201 = Cancelación exitosa, 202 = Previamente cancelado
        const estatusMatch = xmlStr.match(/<EstatusUUID>(201|202)<\/EstatusUUID>/i);
        if (estatusMatch || isAcuseMatch) {
            return { isCancelled: true, isAcuse: true, uuid };
        }
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
            return { isCancelled: true, isAcuse: false, uuid };
        }
    }

    return { isCancelled: false, isAcuse: false, uuid: null };
}

/**
 * Consulta el estado oficial de un CFDI directamente en el Web Service del SAT.
 * Servicio público: https://consultaqr.facturacionelectronica.sat.gob.mx/ConsultaCFDIService.svc
 * No requiere autenticación ni FIEL.
 */
export async function checkSatCfdiStatus(
    uuid: string,
    rfcEmisor: string,
    rfcReceptor: string,
    total: number,
    timeoutMs: number = 5000
): Promise<'Vigente' | 'Cancelado' | 'NoEncontrado' | null> {
    if (!uuid || !rfcEmisor || !rfcReceptor) return null;

    try {
        const cleanUuid = uuid.trim().toUpperCase();
        const cleanEmisor = rfcEmisor.trim().toUpperCase();
        const cleanReceptor = rfcReceptor.trim().toUpperCase();
        const formattedTotal = Number(total || 0).toFixed(6);

        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soapenv:Header/>
  <soapenv:Body>
    <tem:Consulta>
      <tem:expresionImpresa><![CDATA[?re=${cleanEmisor}&rr=${cleanReceptor}&tt=${formattedTotal}&id=${cleanUuid}]]></tem:expresionImpresa>
    </tem:Consulta>
  </soapenv:Body>
</soapenv:Envelope>`;

        const agent = new https.Agent({
            minVersion: 'TLSv1.2',
            rejectUnauthorized: false, // El SAT maneja certificados con raíz no siempre estándar en Node
        });

        const resultXml = await new Promise<string>((resolve, reject) => {
            const req = https.request(
                'https://consultaqr.facturacionelectronica.sat.gob.mx/ConsultaCFDIService.svc',
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

        // Parsear respuesta del SAT
        // <a:Estado>Vigente</a:Estado> o <a:Estado>Cancelado</a:Estado> o <a:Estado>No Encontrado</a:Estado>
        const estadoMatch = resultXml.match(/<(?:[a-zA-Z0-9]+:)?Estado>([^<]+)<\/(?:[a-zA-Z0-9]+:)?Estado>/i);
        if (estadoMatch) {
            const estado = estadoMatch[1].trim();
            if (/^Cancelado$/i.test(estado)) return 'Cancelado';
            if (/^Vigente$/i.test(estado)) return 'Vigente';
            if (/^No\s*Encontrado$/i.test(estado)) return 'NoEncontrado';
        }

        return null;
    } catch (err: any) {
        console.warn(`[SAT Status] No se pudo verificar UUID ${uuid}: ${err.message}`);
        return null;
    }
}
