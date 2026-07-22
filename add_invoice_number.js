const mysql = require('mysql2/promise');

async function main() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: 'admin',
        database: 'service_sales_db'
    });

    try {
        await connection.query("ALTER TABLE ServicePolicies ADD COLUMN invoice_number VARCHAR(100) NULL");
        console.log("Column invoice_number added successfully to ServicePolicies");
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log("Column invoice_number already exists in ServicePolicies");
        } else {
            console.error(e);
        }
    } finally {
        await connection.end();
    }
}
main();
