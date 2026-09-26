const crypto = require('crypto');

function getKey() {
    const rawKey = (process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'sistema-ventas-sat-encryption-key-salt-2026').trim();
    if (/^[0-9a-fA-F]{64}$/.test(rawKey)) return Buffer.from(rawKey, 'hex');
    return crypto.createHash('sha256').update(rawKey).digest();
}

function decrypt(encryptedStr) {
    if (!encryptedStr) return '';
    try {
        const parts = encryptedStr.split(':');
        if (parts.length !== 3) return '';
        const key = getKey();
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const ciphertext = Buffer.from(parts[2], 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
    } catch {
        return '';
    }
}

/**
 * Parser de complementos de pago (Pagos 1.0 y Pagos 2.0)
 */
function parsePagosFromXml(xmlStr) {
    const pagosList = [];

    // Buscar bloques <pago10:Pago> o <pago20:Pago> o <Pago>
    const pagoRegex = /<(?:[a-zA-Z0-9]+:)?Pago\b([^>]*)>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?Pago>/gi;
    let pagoMatch;

    while ((pagoMatch = pagoRegex.exec(xmlStr)) !== null) {
        const pagoAttrs = pagoMatch[1];
        const pagoBody = pagoMatch[2];

        const fechaPagoMatch = pagoAttrs.match(/FechaPago="([^"]+)"/i);
        let fechaPago = fechaPagoMatch ? fechaPagoMatch[1].replace('T', ' ').substring(0, 19) : null;
        const formaPagoMatch = pagoAttrs.match(/FormaDePagoP="([^"]+)"/i);
        const formaPago = formaPagoMatch ? formaPagoMatch[1] : null;
        const monedaMatch = pagoAttrs.match(/MonedaP="([^"]+)"/i);
        const moneda = monedaMatch ? monedaMatch[1] : 'MXN';
        const montoMatch = pagoAttrs.match(/Monto="([^"]+)"/i);
        const montoTotal = montoMatch ? (parseFloat(montoMatch[1]) || 0) : 0;

        // Extraer DoctoRelacionado dentro de este Pago
        const drRegex = /<(?:[a-zA-Z0-9]+:)?DoctoRelacionado\b([^>]*)>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?DoctoRelacionado>|<(?:[a-zA-Z0-9]+:)?DoctoRelacionado\b([^>]*)\/>/gi;
        let drMatch;

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

            // Extraer impuestos en Pagos 2.0 (ImpuestosDR)
            let subtotal = 0;
            let iva = 0;
            let ret_iva = 0;
            let ret_isr = 0;
            let ret_cedular = 0;

            // 1. TrasladosDR (IVA 002)
            const trasRegex = /<(?:[a-zA-Z0-9]+:)?TrasladoDR\b[^>]*\bBaseDR="([^"]+)"[^>]*\bImpuestoDR="002"[^>]*\bImporteDR="([^"]+)"/gi;
            const trasRegex2 = /<(?:[a-zA-Z0-9]+:)?TrasladoDR\b[^>]*\bImpuestoDR="002"[^>]*\bBaseDR="([^"]+)"[^>]*\bImporteDR="([^"]+)"/gi;
            let tm;
            while ((tm = trasRegex.exec(drBody)) !== null) {
                subtotal += parseFloat(tm[1]) || 0;
                iva += parseFloat(tm[2]) || 0;
            }
            while ((tm = trasRegex2.exec(drBody)) !== null) {
                subtotal += parseFloat(tm[1]) || 0;
                iva += parseFloat(tm[2]) || 0;
            }

            // 2. RetencionesDR (ISR 001, IVA 002)
            const retRegex = /<(?:[a-zA-Z0-9]+:)?RetencionDR\b[^>]*\bImpuestoDR="001"[^>]*\bImporteDR="([^"]+)"/gi;
            while ((tm = retRegex.exec(drBody)) !== null) {
                ret_isr += parseFloat(tm[1]) || 0;
            }
            const retIvaRegex = /<(?:[a-zA-Z0-9]+:)?RetencionDR\b[^>]*\bImpuestoDR="002"[^>]*\bImporteDR="([^"]+)"/gi;
            while ((tm = retIvaRegex.exec(drBody)) !== null) {
                ret_iva += parseFloat(tm[1]) || 0;
            }

            // Si no vino desglose en DoctoRelacionado (Pagos 1.0 o Pagos 2.0 sin ImpuestosDR)
            if (subtotal === 0 && impPagado > 0) {
                // Cálculo estándar tasa 16% si no hay detalle
                subtotal = Math.round((impPagado / 1.16) * 100) / 100;
                iva = Math.round((impPagado - subtotal) * 100) / 100;
            }

            pagosList.push({
                docto_relacionado_uuid: idDocumento,
                num_parcialidad: numParcialidad,
                fecha_pago: fechaPago,
                forma_pago: formaPago,
                moneda: monedaDr,
                monto_pagado: impPagado,
                subtotal: Math.round(subtotal * 100) / 100,
                iva: Math.round(iva * 100) / 100,
                ret_iva: Math.round(ret_iva * 100) / 100,
                ret_isr: Math.round(ret_isr * 100) / 100,
                ret_cedular: Math.round(ret_cedular * 100) / 100,
            });
        }
    }

    return pagosList;
}

module.exports = {
    async up(connection) {
        console.log('    -> [007] Actualizando SatCfdis: estado_sat por defecto y columna fecha_pago...');

        // 1. Asegurar estado_sat con DEFAULT 'Vigente' y sin NULLs
        try {
            await connection.query(`
                ALTER TABLE SatCfdis 
                MODIFY COLUMN estado_sat VARCHAR(20) NOT NULL DEFAULT 'Vigente' COMMENT 'Vigente, Cancelado';
            `);
            await connection.query(`
                UPDATE SatCfdis SET estado_sat = 'Vigente' WHERE estado_sat IS NULL OR estado_sat = '';
            `);
            console.log('    -> SatCfdis.estado_sat ajustado a NOT NULL DEFAULT "Vigente".');
        } catch (err) {
            console.warn('    -> Nota al ajustar estado_sat:', err.message);
        }

        // Agregar índice a estado_sat si no existe
        try {
            const [idxs] = await connection.query(`SHOW INDEX FROM SatCfdis WHERE Key_name = 'idx_estado_sat'`);
            if (!idxs || idxs.length === 0) {
                await connection.query(`ALTER TABLE SatCfdis ADD INDEX idx_estado_sat (estado_sat);`);
                console.log('    -> Índice idx_estado_sat creado.');
            }
        } catch (err) {
            console.warn('    -> Nota al crear índice idx_estado_sat:', err.message);
        }

        // 2. Columna fecha_pago en SatCfdis
        try {
            const [cols] = await connection.query(`SHOW COLUMNS FROM SatCfdis LIKE 'fecha_pago'`);
            if (!cols || cols.length === 0) {
                await connection.query(`
                    ALTER TABLE SatCfdis 
                    ADD COLUMN fecha_pago DATETIME NULL COMMENT 'Fecha de pago efectiva si es comprobante tipo P' AFTER fecha_emision;
                `);
                await connection.query(`ALTER TABLE SatCfdis ADD INDEX idx_fecha_pago (fecha_pago);`);
                console.log('    -> Columna e índice fecha_pago agregados a SatCfdis.');
            }
        } catch (err) {
            console.warn('    -> Nota al agregar fecha_pago:', err.message);
        }

        // 3. Crear tabla SatCfdiPagos para desglosar pagos y relacionarlos con facturas PPD
        console.log('    -> [007] Creando tabla SatCfdiPagos...');
        await connection.query(`
            CREATE TABLE IF NOT EXISTS SatCfdiPagos (
                id                      INT AUTO_INCREMENT PRIMARY KEY,
                cfdi_pago_id            INT NOT NULL COMMENT 'FK a SatCfdis del comprobante tipo P',
                cfdi_pago_uuid          VARCHAR(36) NOT NULL,
                docto_relacionado_uuid  VARCHAR(36) NOT NULL COMMENT 'UUID de la factura PPD pagada',
                num_parcialidad         INT NULL DEFAULT 1,
                fecha_pago              DATETIME NOT NULL,
                forma_pago              VARCHAR(10) NULL,
                moneda                  VARCHAR(10) NULL DEFAULT 'MXN',
                monto_pagado            DECIMAL(14,6) NOT NULL DEFAULT 0,
                subtotal                DECIMAL(14,6) NOT NULL DEFAULT 0,
                iva                     DECIMAL(14,6) NOT NULL DEFAULT 0,
                ret_iva                 DECIMAL(14,6) NOT NULL DEFAULT 0,
                ret_isr                 DECIMAL(14,6) NOT NULL DEFAULT 0,
                ret_cedular             DECIMAL(14,6) NOT NULL DEFAULT 0,
                created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_cfdi_pago (cfdi_pago_id),
                INDEX idx_pago_uuid (cfdi_pago_uuid),
                INDEX idx_docto_relacionado (docto_relacionado_uuid),
                INDEX idx_fecha_pago (fecha_pago),
                FOREIGN KEY (cfdi_pago_id) REFERENCES SatCfdis(id) ON DELETE CASCADE
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
        `);
        console.log('    -> Tabla SatCfdiPagos lista.');

        // 4. Backfill de pagos existentes
        console.log('    -> [007] Extrayendo y vinculando pagos de comprobantes existentes...');
        const [pagoRows] = await connection.query(`
            SELECT id, uuid, xml_content 
            FROM SatCfdis 
            WHERE (tipo_cfdi = 'P' OR xml_content LIKE '%:Pago%') 
              AND xml_content IS NOT NULL AND xml_content != ''
        `);

        let pagosProcesados = 0;
        for (const row of pagoRows) {
            const xml = decrypt(row.xml_content);
            if (!xml) continue;

            const pagos = parsePagosFromXml(xml);
            if (pagos.length === 0) continue;

            let totalSubtotal = 0;
            let totalIva = 0;
            let totalRetIsr = 0;
            let totalRetIva = 0;
            let totalRetCedular = 0;
            let primerFechaPago = null;

            for (const p of pagos) {
                if (!primerFechaPago && p.fecha_pago) primerFechaPago = p.fecha_pago;
                totalSubtotal += p.subtotal;
                totalIva += p.iva;
                totalRetIsr += p.ret_isr;
                totalRetIva += p.ret_iva;
                totalRetCedular += p.ret_cedular;

                // Evitar duplicados en SatCfdiPagos
                const [existente] = await connection.query(`
                    SELECT id FROM SatCfdiPagos 
                    WHERE cfdi_pago_uuid = ? AND docto_relacionado_uuid = ? AND num_parcialidad = ?
                    LIMIT 1
                `, [row.uuid, p.docto_relacionado_uuid, p.num_parcialidad]);

                if (!existente || existente.length === 0) {
                    await connection.query(`
                        INSERT INTO SatCfdiPagos 
                        (cfdi_pago_id, cfdi_pago_uuid, docto_relacionado_uuid, num_parcialidad, fecha_pago,
                         forma_pago, moneda, monto_pagado, subtotal, iva, ret_iva, ret_isr, ret_cedular)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        row.id,
                        row.uuid,
                        p.docto_relacionado_uuid,
                        p.num_parcialidad,
                        p.fecha_pago || new Date(),
                        p.forma_pago,
                        p.moneda,
                        p.monto_pagado,
                        p.subtotal,
                        p.iva,
                        p.ret_iva,
                        p.ret_isr,
                        p.ret_cedular
                    ]);
                    pagosProcesados++;
                }
            }

            // Actualizar montos y fecha_pago en el encabezado de SatCfdis si era 0
            if (primerFechaPago || totalSubtotal > 0) {
                await connection.query(`
                    UPDATE SatCfdis 
                    SET fecha_pago = COALESCE(fecha_pago, ?),
                        subtotal = CASE WHEN subtotal = 0 OR subtotal IS NULL THEN ? ELSE subtotal END,
                        iva = CASE WHEN iva = 0 OR iva IS NULL THEN ? ELSE iva END,
                        ret_isr = CASE WHEN ret_isr = 0 OR ret_isr IS NULL THEN ? ELSE ret_isr END,
                        ret_iva = CASE WHEN ret_iva = 0 OR ret_iva IS NULL THEN ? ELSE ret_iva END,
                        ret_cedular = CASE WHEN ret_cedular = 0 OR ret_cedular IS NULL THEN ? ELSE ret_cedular END
                    WHERE id = ?
                `, [primerFechaPago, totalSubtotal, totalIva, totalRetIsr, totalRetIva, totalRetCedular, row.id]);
            }
        }

        console.log(`    -> [007] Migración finalizada. Se registraron ${pagosProcesados} relaciones de pago.`);
    }
};
