import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'admin',
  database: process.env.DB_NAME || 'service_sales_db',
  ssl: process.env.DB_HOST && process.env.DB_HOST !== 'localhost' ? {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true
  } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  multipleStatements: true,
});

export default pool;
