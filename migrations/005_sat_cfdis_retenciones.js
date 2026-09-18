module.exports = {
    async up(connection) {
        const cols = [
            { name: 'ret_iva',     comment: 'Retención de IVA (Impuesto 002)' },
            { name: 'ret_isr',     comment: 'Retención de ISR (Impuesto 001)' },
            { name: 'ret_cedular', comment: 'Retención Cedular / ISH (Impuesto 003)' },
        ];

        for (const col of cols) {
            try {
                const [existing] = await connection.query(
                    `SHOW COLUMNS FROM SatCfdis LIKE '${col.name}';`
                );
                if (!existing || existing.length === 0) {
                    await connection.query(`
                        ALTER TABLE SatCfdis
                        ADD COLUMN ${col.name} DECIMAL(14,6) NULL DEFAULT 0
                        COMMENT '${col.comment}'
                        AFTER iva;
                    `);
                    console.log(`    -> Columna ${col.name} agregada a SatCfdis.`);
                } else {
                    console.log(`    -> Columna ${col.name} ya existe, omitiendo.`);
                }
            } catch (err) {
                console.warn(`    -> Error al agregar ${col.name}:`, err.message);
            }
        }
    }
};
