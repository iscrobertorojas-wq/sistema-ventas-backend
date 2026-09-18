/**
 * Utilidad compartida para analizar y extraer campos clave de un archivo XML de CFDI (v3.3 y v4.0).
 * Incluye: IVA traslado, retenciones de IVA (002), ISR (001) y Cedular/ISH (003).
 */
export interface ParsedCfdi {
    uuid: string | null;
    rfc_emisor: string;
    nombre_emisor: string | null;
    rfc_receptor: string;
    nombre_receptor: string | null;
    fecha_emision: string | null;
    subtotal: number;
    iva: number;
    ret_iva: number;
    ret_isr: number;
    ret_cedular: number;
    total: number;
    moneda: string;
    tipo_cfdi: string | null;
    metodo_pago: string | null;
    forma_pago: string | null;
    uso_cfdi: string | null;
    tipo: 'emitido' | 'recibido';
}

export function parseCfdiXml(xmlStr: string, userRfc?: string | null): ParsedCfdi | null {
    try {
        // 1. Extraer UUID del Timbre Fiscal Digital
        const uuidMatch = xmlStr.match(/TimbreFiscalDigital[^>]+UUID="([^"]+)"/i) ||
                          xmlStr.match(/UUID="([0-9a-fA-F-]{36})"/i);
        const uuid = uuidMatch ? uuidMatch[1].trim().toUpperCase() : null;

        if (!uuid) {
            return null; // No es un CFDI timbrado válido
        }

        // Helper para extraer atributos de Comprobante
        const getAttr = (attr: string): string | null => {
            const m = xmlStr.match(new RegExp(`(?:cfdi:)?Comprobante[^>]+${attr}="([^"]+)"`, 'i')) ||
                      xmlStr.match(new RegExp(`\\b${attr}="([^"]+)"`, 'i'));
            return m ? m[1].trim() : null;
        };

        // 2. Emisor
        const rfcEmisorMatch = xmlStr.match(/<cfdi:Emisor[^>]+Rfc="([^"]+)"/i) ||
                               xmlStr.match(/<Emisor[^>]+Rfc="([^"]+)"/i);
        const rfcEmisor = rfcEmisorMatch ? rfcEmisorMatch[1].trim().toUpperCase() : '';

        const nombreEmisorMatch = xmlStr.match(/<cfdi:Emisor[^>]+Nombre="([^"]+)"/i) ||
                                 xmlStr.match(/<Emisor[^>]+Nombre="([^"]+)"/i);
        const nombreEmisor = nombreEmisorMatch ? nombreEmisorMatch[1].trim() : null;

        // 3. Receptor
        const rfcReceptorMatch = xmlStr.match(/<cfdi:Receptor[^>]+Rfc="([^"]+)"/i) ||
                                 xmlStr.match(/<Receptor[^>]+Rfc="([^"]+)"/i);
        const rfcReceptor = rfcReceptorMatch ? rfcReceptorMatch[1].trim().toUpperCase() : '';

        const nombreReceptorMatch = xmlStr.match(/<cfdi:Receptor[^>]+Nombre="([^"]+)"/i) ||
                                   xmlStr.match(/<Receptor[^>]+Nombre="([^"]+)"/i);
        const nombreReceptor = nombreReceptorMatch ? nombreReceptorMatch[1].trim() : null;

        // 4. Montos del Comprobante
        const subtotal = parseFloat(getAttr('SubTotal') || getAttr('subTotal') || '0') || 0;
        const total = parseFloat(getAttr('Total') || getAttr('total') || '0') || 0;

        // 5. IVA Traslado (Impuesto 002)
        let iva = 0;
        const totalImpTrasMatch = xmlStr.match(/TotalImpuestosTrasladados="([^"]+)"/i);
        if (totalImpTrasMatch) {
            iva = parseFloat(totalImpTrasMatch[1]) || 0;
        } else {
            // Buscar traslado IVA 002 en el nodo Traslados
            const trasladosMatch =
                xmlStr.match(/<(?:cfdi:)?Traslado[^>]+Impuesto="002"[^>]+Importe="([^"]+)"/i) ||
                xmlStr.match(/<(?:cfdi:)?Traslado[^>]+Importe="([^"]+)"[^>]+Impuesto="002"/i);
            if (trasladosMatch) {
                iva = parseFloat(trasladosMatch[1]) || 0;
            } else if (total > subtotal) {
                iva = Math.round((total - subtotal) * 100) / 100;
            }
        }

        // 6. Retenciones
        // IVA Retenido (Impuesto 002 dentro de Retenciones)
        let ret_iva = 0;
        const retIvaMatch =
            xmlStr.match(/<(?:cfdi:)?Retencion[^>]+Impuesto="002"[^>]+Importe="([^"]+)"/i) ||
            xmlStr.match(/<(?:cfdi:)?Retencion[^>]+Importe="([^"]+)"[^>]+Impuesto="002"/i);
        if (retIvaMatch) {
            ret_iva = parseFloat(retIvaMatch[1]) || 0;
        } else {
            // Fallback: TotalImpuestosRetenidos solo si hay un único Impuesto="002"
            const totalRetMatch = xmlStr.match(/TotalImpuestosRetenidos="([^"]+)"/i);
            if (totalRetMatch) {
                // Solo asignamos al IVA si encontramos exactamente Impuesto="002"
                const soloCfdiIva = xmlStr.match(/<(?:cfdi:)?Retencion[^>]+Impuesto="002"/i);
                const soloCfdiIsr = xmlStr.match(/<(?:cfdi:)?Retencion[^>]+Impuesto="001"/i);
                if (soloCfdiIva && !soloCfdiIsr) {
                    ret_iva = parseFloat(totalRetMatch[1]) || 0;
                }
            }
        }

        // ISR Retenido (Impuesto 001)
        let ret_isr = 0;
        const retIsrMatch =
            xmlStr.match(/<(?:cfdi:)?Retencion[^>]+Impuesto="001"[^>]+Importe="([^"]+)"/i) ||
            xmlStr.match(/<(?:cfdi:)?Retencion[^>]+Importe="([^"]+)"[^>]+Impuesto="001"/i);
        if (retIsrMatch) {
            ret_isr = parseFloat(retIsrMatch[1]) || 0;
        }

        // Retención Cedular / ISH (Impuesto 003 o ImpLocal en complemento)
        let ret_cedular = 0;
        const retCedularMatch =
            xmlStr.match(/<(?:cfdi:)?Retencion[^>]+Impuesto="003"[^>]+Importe="([^"]+)"/i) ||
            xmlStr.match(/<(?:cfdi:)?Retencion[^>]+Importe="([^"]+)"[^>]+Impuesto="003"/i);
        if (retCedularMatch) {
            ret_cedular = parseFloat(retCedularMatch[1]) || 0;
        } else {
            // Complemento LocalFiscalEmisor: ImpuestosLocalesRetenidos ImpLocRetenido
            const localRetMatch = xmlStr.match(/ImpLocRetenido="([^"]+)"/i) ||
                                  xmlStr.match(/ImpuestoLocalRetenido="([^"]+)"/i);
            if (localRetMatch) {
                ret_cedular = parseFloat(localRetMatch[1]) || 0;
            }
        }

        // 7. Fecha de emisión
        let fechaEmision = getAttr('Fecha') || getAttr('fecha');
        if (fechaEmision) {
            fechaEmision = fechaEmision.replace('T', ' ').substring(0, 19);
        }

        // 8. Otros metadatos
        const moneda = getAttr('Moneda') || getAttr('moneda') || 'MXN';
        const tipoCfdi = getAttr('TipoDeComprobante') || getAttr('tipoDeComprobante') || 'I';
        const metodoPago = getAttr('MetodoPago') || getAttr('metodoPago');
        const formaPago = getAttr('FormaPago') || getAttr('formaPago');

        const usoCfdiMatch = xmlStr.match(/<cfdi:Receptor[^>]+UsoCFDI="([^"]+)"/i) ||
                             xmlStr.match(/<Receptor[^>]+UsoCFDI="([^"]+)"/i);
        const usoCfdi = usoCfdiMatch ? usoCfdiMatch[1].trim() : null;

        // 9. Determinar tipo (emitido vs recibido)
        let tipo: 'emitido' | 'recibido' = 'recibido';
        if (userRfc) {
            const cleanUserRfc = userRfc.trim().toUpperCase();
            if (rfcEmisor === cleanUserRfc) {
                tipo = 'emitido';
            } else if (rfcReceptor === cleanUserRfc) {
                tipo = 'recibido';
            }
        }

        return {
            uuid,
            rfc_emisor: rfcEmisor,
            nombre_emisor: nombreEmisor,
            rfc_receptor: rfcReceptor,
            nombre_receptor: nombreReceptor,
            fecha_emision: fechaEmision,
            subtotal,
            iva,
            ret_iva,
            ret_isr,
            ret_cedular,
            total,
            moneda,
            tipo_cfdi: tipoCfdi,
            metodo_pago: metodoPago,
            forma_pago: formaPago,
            uso_cfdi: usoCfdi,
            tipo
        };
    } catch (err) {
        console.error('[CFDI Parser] Error analizando XML:', err);
        return null;
    }
}
