const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Manually parse .env.local if it exists
let dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'admin',
    database: 'service_sales_db'
};

try {
    const envPath = path.join(__dirname, '.env.local');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const lines = envContent.split('\n');
        for (const line of lines) {
            const parts = line.trim().split('=');
            if (parts.length === 2) {
                const key = parts[0].trim();
                const value = parts[1].trim();
                if (key === 'DB_HOST') dbConfig.host = value;
                if (key === 'DB_USER') dbConfig.user = value;
                if (key === 'DB_PASSWORD') dbConfig.password = value;
                if (key === 'DB_NAME') dbConfig.database = value;
            }
        }
    }
} catch (err) {
    console.warn('Could not read .env.local, using defaults:', err.message);
}

async function run() {
    console.log('Connecting to database with config:', {
        host: dbConfig.host,
        user: dbConfig.user,
        database: dbConfig.database
    });
    
    try {
        const connection = await mysql.createConnection({
            ...dbConfig,
            multipleStatements: true
        });

        try {
            const sql = fs.readFileSync(path.join(__dirname, 'add_contpaqi_tables.sql'), 'utf8');
            await connection.query(sql);
            console.log('Contpaqi tables created successfully.');
        } catch (error) {
            console.error('Error running migration:', error);
        } finally {
            await connection.end();
        }
    } catch (err) {
        console.error('Failed to establish database connection:', err);
    }
}

run();
