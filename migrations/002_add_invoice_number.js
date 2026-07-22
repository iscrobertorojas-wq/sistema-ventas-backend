module.exports = {
    async up(connection) {
        try {
            await connection.query("ALTER TABLE ServicePolicies ADD COLUMN invoice_number VARCHAR(100) NULL");
        } catch (e) {
            // Ignore if the column already exists
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log("    -> Columna invoice_number ya existe. Saltando...");
            } else {
                throw e;
            }
        }
    }
};
