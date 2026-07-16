module.exports = {
    async up(connection) {
        try {
            await connection.query("ALTER TABLE PolicyServiceRecords ADD COLUMN requested_by VARCHAR(255) NULL");
        } catch (e) {
            // Ignore if the column already exists (e.g. from a manual local update)
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log("    -> Columna requested_by ya existe. Saltando...");
            } else {
                throw e;
            }
        }
    }
};
