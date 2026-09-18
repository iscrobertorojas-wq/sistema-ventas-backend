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

function parseRetencionesFromXml(xmlStr) {
    let rootImpuestosXml = '';
    const conceptosEndIdx = xmlStr.search(/<\/(?:cfdi:)?Conceptos>/i);
    if (conceptosEndIdx !== -1) {
        const afterConceptos = xmlStr.substring(conceptosEndIdx);
        const rootImpMatch = afterConceptos.match(/<(?:cfdi:)?Impuestos[\s\S]*?<\/(?:cfdi:)?Impuestos>/i);
        if (rootImpMatch) rootImpuestosXml = rootImpMatch[0];
    }

    let ret_iva = 0;
    let ret_isr = 0;
    let ret_cedular = 0;

    const retContextXml = rootImpuestosXml || xmlStr;

    // Retención IVA 002
    const ivaRetRegex1 = /<(?:cfdi:)?Retencion\b[^>]*\bImpuesto="002"[^>]*\bImporte="([^"]+)"/gi;
    const ivaRetRegex2 = /<(?:cfdi:)?Retencion\b[^>]*\bImporte="([^"]+)"[^>]*\bImpuesto="002"/gi;
    let m;
    while ((m = ivaRetRegex1.exec(retContextXml)) !== null) ret_iva += parseFloat(m[1]) || 0;
    while ((m = ivaRetRegex2.exec(retContextXml)) !== null) ret_iva += parseFloat(m[1]) || 0;

    // Retención ISR 001
    const isrRetRegex1 = /<(?:cfdi:)?Retencion\b[^>]*\bImpuesto="001"[^>]*\bImporte="([^"]+)"/gi;
    const isrRetRegex2 = /<(?:cfdi:)?Retencion\b[^>]*\bImporte="([^"]+)"[^>]*\bImpuesto="001"/gi;
    while ((m = isrRetRegex1.exec(retContextXml)) !== null) ret_isr += parseFloat(m[1]) || 0;
    while ((m = isrRetRegex2.exec(retContextXml)) !== null) ret_isr += parseFloat(m[1]) || 0;

    // Fallback: si no hubo en el nodo raíz global, buscar en conceptos
    if (rootImpuestosXml && ret_iva === 0 && ret_isr === 0) {
        const conceptosXml = xmlStr.substring(0, conceptosEndIdx);
        while ((m = ivaRetRegex1.exec(conceptosXml)) !== null) ret_iva += parseFloat(m[1]) || 0;
        while ((m = ivaRetRegex2.exec(conceptosXml)) !== null) ret_iva += parseFloat(m[1]) || 0;
        while ((m = isrRetRegex1.exec(conceptosXml)) !== null) ret_isr += parseFloat(m[1]) || 0;
        while ((m = isrRetRegex2.exec(conceptosXml)) !== null) ret_isr += parseFloat(m[1]) || 0;
    }

    // Complemento ImpuestosLocales (Cedular / ISH)
    const localTotalMatch = xmlStr.match(/<[^>]*ImpuestosLocales\b[^>]*\bTotaldeRetenciones="([^"]+)"/i);
    if (localTotalMatch) {
        ret_cedular += parseFloat(localTotalMatch[1]) || 0;
    } else {
        const locRetRegex = /<[^>]*RetencionesLocales\b[^>]*\bImporte="([^"]+)"/gi;
        while ((m = locRetRegex.exec(xmlStr)) !== null) {
            ret_cedular += parseFloat(m[1]) || 0;
        }
    }

    return {
        ret_iva: Math.round(ret_iva * 100) / 100,
        ret_isr: Math.round(ret_isr * 100) / 100,
        ret_cedular: Math.round(ret_cedular * 100) / 100,
    };
}

module.exports = {
    async up(connection) {
        console.log('    -> Recalculando retenciones para CFDIs existentes...');
        const [rows] = await connection.query(
            'SELECT id, xml_content FROM SatCfdis WHERE xml_content IS NOT NULL AND xml_content != ""'
        );

        let updated = 0;
        for (const row of rows) {
            const xml = decrypt(row.xml_content);
            if (!xml) continue;

            const ret = parseRetencionesFromXml(xml);
            if (ret.ret_iva > 0 || ret.ret_isr > 0 || ret.ret_cedular > 0) {
                await connection.query(
                    'UPDATE SatCfdis SET ret_iva = ?, ret_isr = ?, ret_cedular = ? WHERE id = ?',
                    [ret.ret_iva, ret.ret_isr, ret.ret_cedular, row.id]
                );
                updated++;
            }
        }
        console.log(`    -> Retenciones recalculadas exitosamente en ${updated} CFDIs.`);
    }
};
