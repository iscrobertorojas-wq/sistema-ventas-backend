module.exports = {
    async up(connection) {
        // Permitir que request_id sea NULL para cuando los XMLs se carguen manualmente (sin solicitud al SAT)
        try {
            await connection.query(`
                ALTER TABLE SatCfdis 
                MODIFY COLUMN request_id INT NULL COMMENT 'FK opcional a SatDownloadRequests';
            `);
            console.log('    -> SatCfdis.request_id modificado a NULL.');
        } catch (err) {
            console.warn('    -> Nota al modificar SatCfdis.request_id:', err.message);
        }

        // Agregar columna updated_at si no existe
        try {
            const [cols] = await connection.query(`
                SHOW COLUMNS FROM SatCfdis LIKE 'updated_at';
            `);
            if (!cols || cols.length === 0) {
                await connection.query(`
                    ALTER TABLE SatCfdis 
                    ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;
                `);
                console.log('    -> Columna updated_at agregada a SatCfdis.');
            }
        } catch (err) {
            console.warn('    -> Nota al agregar updated_at:', err.message);
        }
    }
};
