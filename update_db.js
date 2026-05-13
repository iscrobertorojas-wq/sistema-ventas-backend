const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function run() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: 'admin',
        database: 'service_sales_db',
        multipleStatements: true
    });

    try {
        const sql = fs.readFileSync(path.join(__dirname, 'add_quotations.sql'), 'utf8');
        await connection.query(sql);
        console.log('Database updated successfully');
    } catch (error) {
        console.error('Error updating database:', error);
    } finally {
        await connection.end();
    }
}

run();
