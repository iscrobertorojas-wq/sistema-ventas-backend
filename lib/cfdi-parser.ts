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

        // 5. Impuestos del CFDI
        // En CFDI 3.3 y 4.0, el nodo raíz de Impuestos globales se ubica después de </Conceptos>.
        let rootImpuestosXml = '';
        const conceptosEndIdx = xmlStr.search(/<\/(?:cfdi:)?Conceptos>/i);
        if (conceptosEndIdx !== -1) {
            const afterConceptos = xmlStr.substring(conceptosEndIdx);
            const rootImpMatch = afterConceptos.match(/<(?:cfdi:)?Impuestos[\s\S]*?<\/(?:cfdi:)?Impuestos>/i);
            if (rootImpMatch) {
                rootImpuestosXml = rootImpMatch[0];
            }
        }

        // --- IVA Trasladado (Impuesto 002) ---
        let iva = 0;
        const totalImpTrasMatch = (rootImpuestosXml || xmlStr).match(/TotalImpuestosTrasladados="([^"]+)"/i);
        if (totalImpTrasMatch) {
            iva = parseFloat(totalImpTrasMatch[1]) || 0;
        } else {
            const trasladosXml = rootImpuestosXml || xmlStr;
            const trasMatch =
                trasladosXml.match(/<(?:cfdi:)?Traslado\b[^>]*\bImpuesto="002"[^>]*\bImporte="([^"]+)"/i) ||
                trasladosXml.match(/<(?:cfdi:)?Traslado\b[^>]*\bImporte="([^"]+)"[^>]*\bImpuesto="002"/i);
            if (trasMatch) {
                iva = parseFloat(trasMatch[1]) || 0;
            } else if (total > subtotal) {
                iva = Math.round((total - subtotal) * 100) / 100;
            }
        }

        // --- Retenciones Federales (IVA 002, ISR 001, IEPS/Federal 003) ---
        let ret_iva = 0;
        let ret_isr = 0;
        let ret_cedular = 0;

        // Contexto primario: el nodo <Impuestos> global de la factura
        const retContextXml = rootImpuestosXml || xmlStr;

        // 5.1 Retención IVA (Impuesto 002)
        const ivaRetRegex1 = /<(?:cfdi:)?Retencion\b[^>]*\bImpuesto="002"[^>]*\bImporte="([^"]+)"/gi;
        const ivaRetRegex2 = /<(?:cfdi:)?Retencion\b[^>]*\bImporte="([^"]+)"[^>]*\bImpuesto="002"/gi;
        let m: RegExpExecArray | null;
        while ((m = ivaRetRegex1.exec(retContextXml)) !== null) ret_iva += parseFloat(m[1]) || 0;
        while ((m = ivaRetRegex2.exec(retContextXml)) !== null) ret_iva += parseFloat(m[1]) || 0;

        // 5.2 Retención ISR (Impuesto 001)
        const isrRetRegex1 = /<(?:cfdi:)?Retencion\b[^>]*\bImpuesto="001"[^>]*\bImporte="([^"]+)"/gi;
        const isrRetRegex2 = /<(?:cfdi:)?Retencion\b[^>]*\bImporte="([^"]+)"[^>]*\bImpuesto="001"/gi;
        while ((m = isrRetRegex1.exec(retContextXml)) !== null) ret_isr += parseFloat(m[1]) || 0;
        while ((m = isrRetRegex2.exec(retContextXml)) !== null) ret_isr += parseFloat(m[1]) || 0;

        // 5.3 Retención Impuesto 003 (IEPS o Cedular federal)
        const cedRetRegex1 = /<(?:cfdi:)?Retencion\b[^>]*\bImpuesto="003"[^>]*\bImporte="([^"]+)"/gi;
        const cedRetRegex2 = /<(?:cfdi:)?Retencion\b[^>]*\bImporte="([^"]+)"[^>]*\bImpuesto="003"/gi;
        while ((m = cedRetRegex1.exec(retContextXml)) !== null) ret_cedular += parseFloat(m[1]) || 0;
        while ((m = cedRetRegex2.exec(retContextXml)) !== null) ret_cedular += parseFloat(m[1]) || 0;

        // Fallback: si no hubo en el nodo raíz global, buscar si hubo en conceptos
        if (rootImpuestosXml && ret_iva === 0 && ret_isr === 0) {
            const conceptosXml = xmlStr.substring(0, conceptosEndIdx);
            while ((m = ivaRetRegex1.exec(conceptosXml)) !== null) ret_iva += parseFloat(m[1]) || 0;
            while ((m = ivaRetRegex2.exec(conceptosXml)) !== null) ret_iva += parseFloat(m[1]) || 0;
            while ((m = isrRetRegex1.exec(conceptosXml)) !== null) ret_isr += parseFloat(m[1]) || 0;
            while ((m = isrRetRegex2.exec(conceptosXml)) !== null) ret_isr += parseFloat(m[1]) || 0;
        }

        // 5.4 Retenciones Locales (Cedular / ISH / 5 al millar) en Complemento ImpuestosLocales
        const localTotalMatch = xmlStr.match(/<[^>]*ImpuestosLocales\b[^>]*\bTotaldeRetenciones="([^"]+)"/i);
        if (localTotalMatch) {
            ret_cedular += parseFloat(localTotalMatch[1]) || 0;
        } else {
            const locRetRegex = /<[^>]*RetencionesLocales\b[^>]*\bImporte="([^"]+)"/gi;
            while ((m = locRetRegex.exec(xmlStr)) !== null) {
                ret_cedular += parseFloat(m[1]) || 0;
            }
        }

        // Redondear a 2 decimales
        iva = Math.round(iva * 100) / 100;
        ret_iva = Math.round(ret_iva * 100) / 100;
        ret_isr = Math.round(ret_isr * 100) / 100;
        ret_cedular = Math.round(ret_cedular * 100) / 100;

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
