/**
 * Utilidad compartida para analizar y extraer campos clave de un archivo XML de CFDI (v3.3 y v4.0).
 * Incluye: IVA traslado, retenciones de IVA (002), ISR (001) y Cedular/ISH (003),
 * así como extracción detallada de complementos de recepción de pagos (Pagos 1.0 y 2.0).
 */

export interface ParsedPaymentDoc {
    id_documento: string; // UUID de la factura PPD pagada
    num_parcialidad: number;
    imp_saldo_ant?: number;
    imp_pagado: number;
    imp_saldo_insoluto?: number;
    moneda_dr: string;
    subtotal: number;
    iva: number;
    ret_iva: number;
    ret_isr: number;
    ret_cedular: number;
}

export interface ParsedPayment {
    fecha_pago: string; // 'YYYY-MM-DD HH:mm:ss'
    forma_pago?: string | null;
    moneda: string;
    monto: number;
    doctos_relacionados: ParsedPaymentDoc[];
}

export interface ParsedCfdi {
    uuid: string | null;
    rfc_emisor: string;
    nombre_emisor: string | null;
    rfc_receptor: string;
    nombre_receptor: string | null;
    fecha_emision: string | null;
    fecha_pago?: string | null;
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
    pagos?: ParsedPayment[];
}

/**
 * Extrae los pagos y documentos relacionados de un CFDI de tipo Pago (v1.0 y v2.0).
 */
export function parseCfdiPagos(xmlStr: string): ParsedPayment[] {
    const pagos: ParsedPayment[] = [];

    const pagoRegex = /<(?:[a-zA-Z0-9]+:)?Pago\b([^>]*)>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?Pago>/gi;
    let pagoMatch: RegExpExecArray | null;

    while ((pagoMatch = pagoRegex.exec(xmlStr)) !== null) {
        const pagoAttrs = pagoMatch[1];
        const pagoBody = pagoMatch[2];

        const fechaPagoMatch = pagoAttrs.match(/FechaPago="([^"]+)"/i);
        const fechaPago = fechaPagoMatch ? fechaPagoMatch[1].replace('T', ' ').substring(0, 19) : '';
        const formaPagoMatch = pagoAttrs.match(/FormaDePagoP="([^"]+)"/i);
        const formaPago = formaPagoMatch ? formaPagoMatch[1] : null;
        const monedaMatch = pagoAttrs.match(/MonedaP="([^"]+)"/i);
        const moneda = monedaMatch ? monedaMatch[1] : 'MXN';
        const montoMatch = pagoAttrs.match(/Monto="([^"]+)"/i);
        const montoTotal = montoMatch ? (parseFloat(montoMatch[1]) || 0) : 0;

        const doctos: ParsedPaymentDoc[] = [];

        // DoctoRelacionado con o sin cierre separado
        const drRegex = /<(?:[a-zA-Z0-9]+:)?DoctoRelacionado\b([^>]*)>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?DoctoRelacionado>|<(?:[a-zA-Z0-9]+:)?DoctoRelacionado\b([^>]*)\/>/gi;
        let drMatch: RegExpExecArray | null;

        while ((drMatch = drRegex.exec(pagoBody)) !== null) {
            const drAttrs = drMatch[1] || drMatch[3] || '';
            const drBody = drMatch[2] || '';

            const idDocMatch = drAttrs.match(/IdDocumento="([^"]+)"/i);
            const idDocumento = idDocMatch ? idDocMatch[1].trim().toUpperCase() : null;
            if (!idDocumento) continue;

            const numParcMatch = drAttrs.match(/NumParcialidad="([^"]+)"/i);
            const numParcialidad = numParcMatch ? (parseInt(numParcMatch[1], 10) || 1) : 1;

            const impPagadoMatch = drAttrs.match(/ImpPagado="([^"]+)"/i);
            const impPagado = impPagadoMatch ? (parseFloat(impPagadoMatch[1]) || 0) : montoTotal;

            const monedaDrMatch = drAttrs.match(/MonedaDR="([^"]+)"/i);
            const monedaDr = monedaDrMatch ? monedaDrMatch[1] : moneda;

            let subtotal = 0;
            let iva = 0;
            let ret_iva = 0;
            let ret_isr = 0;
            let ret_cedular = 0;

            // Traslados en Pagos 2.0 (TrasladoDR ImpuestoDR="002")
            const trasRegex1 = /<(?:[a-zA-Z0-9]+:)?TrasladoDR\b[^>]*\bBaseDR="([^"]+)"[^>]*\bImpuestoDR="002"[^>]*\bImporteDR="([^"]+)"/gi;
            const trasRegex2 = /<(?:[a-zA-Z0-9]+:)?TrasladoDR\b[^>]*\bImpuestoDR="002"[^>]*\bBaseDR="([^"]+)"[^>]*\bImporteDR="([^"]+)"/gi;
            let tm: RegExpExecArray | null;
            while ((tm = trasRegex1.exec(drBody)) !== null) {
                subtotal += parseFloat(tm[1]) || 0;
                iva += parseFloat(tm[2]) || 0;
            }
            while ((tm = trasRegex2.exec(drBody)) !== null) {
                subtotal += parseFloat(tm[1]) || 0;
                iva += parseFloat(tm[2]) || 0;
            }

            // Retenciones en Pagos 2.0 (RetencionDR)
            const isrRetRegex = /<(?:[a-zA-Z0-9]+:)?RetencionDR\b[^>]*\bImpuestoDR="001"[^>]*\bImporteDR="([^"]+)"/gi;
            while ((tm = isrRetRegex.exec(drBody)) !== null) {
                ret_isr += parseFloat(tm[1]) || 0;
            }
            const ivaRetRegex = /<(?:[a-zA-Z0-9]+:)?RetencionDR\b[^>]*\bImpuestoDR="002"[^>]*\bImporteDR="([^"]+)"/gi;
            while ((tm = ivaRetRegex.exec(drBody)) !== null) {
                ret_iva += parseFloat(tm[1]) || 0;
            }

            // Fallback si no vinieron impuestos detallados en el docto (Pagos 1.0)
            if (subtotal === 0 && impPagado > 0) {
                subtotal = Math.round((impPagado / 1.16) * 100) / 100;
                iva = Math.round((impPagado - subtotal) * 100) / 100;
            }

            doctos.push({
                id_documento: idDocumento,
                num_parcialidad: numParcialidad,
                imp_pagado: impPagado,
                moneda_dr: monedaDr,
                subtotal: Math.round(subtotal * 100) / 100,
                iva: Math.round(iva * 100) / 100,
                ret_iva: Math.round(ret_iva * 100) / 100,
                ret_isr: Math.round(ret_isr * 100) / 100,
                ret_cedular: Math.round(ret_cedular * 100) / 100,
            });
        }

        // Si no hubo DoctoRelacionado con la sintaxis habitual, buscar si hubo cfdi:CfdiRelacionados
        if (doctos.length === 0) {
            const relUuidRegex = /<(?:cfdi:)?CfdiRelacionado\b[^>]*\bUUID="([0-9a-fA-F-]{36})"/gi;
            let rm: RegExpExecArray | null;
            while ((rm = relUuidRegex.exec(xmlStr)) !== null) {
                const relUuid = rm[1].toUpperCase();
                const sub = Math.round((montoTotal / 1.16) * 100) / 100;
                doctos.push({
                    id_documento: relUuid,
                    num_parcialidad: 1,
                    imp_pagado: montoTotal,
                    moneda_dr: moneda,
                    subtotal: sub,
                    iva: Math.round((montoTotal - sub) * 100) / 100,
                    ret_iva: 0,
                    ret_isr: 0,
                    ret_cedular: 0
                });
            }
        }

        pagos.push({
            fecha_pago: fechaPago,
            forma_pago: formaPago,
            moneda,
            monto: montoTotal,
            doctos_relacionados: doctos
        });
    }

    return pagos;
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
        let subtotal = parseFloat(getAttr('SubTotal') || getAttr('subTotal') || '0') || 0;
        let total = parseFloat(getAttr('Total') || getAttr('total') || '0') || 0;

        // 5. Impuestos del CFDI
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

        // 9. Si es comprobante tipo P (Pago), analizar el complemento de pagos
        let fechaPago: string | null = null;
        let pagos: ParsedPayment[] = [];
        if (tipoCfdi === 'P' || xmlStr.includes(':Pago')) {
            pagos = parseCfdiPagos(xmlStr);
            if (pagos.length > 0) {
                fechaPago = pagos[0].fecha_pago || null;
                // Si subtotal y total eran 0 (regla SAT para tipo P), sumar los montos del complemento
                let sumSubtotal = 0;
                let sumIva = 0;
                let sumRetIsr = 0;
                let sumRetIva = 0;
                let sumRetCedular = 0;
                let sumTotal = 0;

                for (const p of pagos) {
                    sumTotal += p.monto;
                    for (const d of p.doctos_relacionados) {
                        sumSubtotal += d.subtotal;
                        sumIva += d.iva;
                        sumRetIsr += d.ret_isr;
                        sumRetIva += d.ret_iva;
                        sumRetCedular += d.ret_cedular;
                    }
                }

                if (subtotal === 0) subtotal = sumSubtotal;
                if (iva === 0) iva = sumIva;
                if (ret_isr === 0) ret_isr = sumRetIsr;
                if (ret_iva === 0) ret_iva = sumRetIva;
                if (ret_cedular === 0) ret_cedular = sumRetCedular;
                if (total === 0) total = sumTotal;
            }
        }

        // Redondear a 2 decimales
        iva = Math.round(iva * 100) / 100;
        ret_iva = Math.round(ret_iva * 100) / 100;
        ret_isr = Math.round(ret_isr * 100) / 100;
        ret_cedular = Math.round(ret_cedular * 100) / 100;
        subtotal = Math.round(subtotal * 100) / 100;
        total = Math.round(total * 100) / 100;

        // 10. Determinar tipo (emitido vs recibido)
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
            fecha_pago: fechaPago,
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
            tipo,
            pagos: pagos.length > 0 ? pagos : undefined
        };
    } catch (err) {
        console.error('[CFDI Parser] Error analizando XML:', err);
        return null;
    }
}
