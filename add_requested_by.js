const mysql = require('mysql2/promise');

async function main() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: 'admin',
        database: 'service_sales_db'
    });

    try {
        await connection.query("ALTER TABLE PolicyServiceRecords ADD COLUMN requested_by VARCHAR(255) NULL");
        console.log("Column requested_by added successfully");
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log("Column requested_by already exists");
        } else {
            console.error(e);
        }
    } finally {
        await connection.end();
    }
}
main();
