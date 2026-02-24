import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const dbName = process.env.DB_NAME || 'service_sales_db';
        let sqlDump = `-- Database Backup: ${dbName}\n-- Generated at: ${new Date().toISOString()}\n\n`;
        sqlDump += `SET FOREIGN_KEY_CHECKS=0;\n\n`;

        // 1. Get all tables
        const [tables] = await pool.query<RowDataPacket[]>('SHOW TABLES');
        const tableNames = tables.map(t => Object.values(t)[0] as string);

        for (const tableName of tableNames) {
            // 2. Get CREATE TABLE statement
            const [createTableResult] = await pool.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${tableName}\``);
            let createSql = createTableResult[0]['Create Table'];
            // Ensure IF NOT EXISTS is present for extra safety during restore
            createSql = createSql.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS');

            sqlDump += `-- Structure for table \`${tableName}\`\n`;
            sqlDump += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;
            sqlDump += `${createSql};\n\n`;

            // 3. Get data
            const [rows] = await pool.query<RowDataPacket[]>(`SELECT * FROM \`${tableName}\``);
            if (rows.length > 0) {
                sqlDump += `-- Data for table \`${tableName}\`\n`;
                const columns = Object.keys(rows[0]);
                const columnList = columns.map(c => `\`${c}\``).join(', ');

                for (const row of rows) {
                    const values = columns.map(col => {
                        const val = row[col];
                        if (val === null) return 'NULL';
                        if (typeof val === 'string') {
                            // Escape single quotes correctly for SQL
                            return `'${val.replace(/'/g, "''")}'`;
                        }
                        if (val instanceof Date) {
                            // Format date for MySQL
                            return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
                        }
                        if (Buffer.isBuffer(val)) {
                            // Handle potential blob/binary data if any (though unlikely in this schema)
                            return `X'${val.toString('hex')}'`;
                        }
                        return val;
                    });
                    sqlDump += `INSERT INTO \`${tableName}\` (${columnList}) VALUES (${values.join(', ')});\n`;
                }
                sqlDump += '\n';
            }
        }

        sqlDump += `SET FOREIGN_KEY_CHECKS=1;\n`;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `backup-${dbName}-${timestamp}.sql`;

        return new NextResponse(sqlDump, {
            status: 200,
            headers: {
                'Content-Type': 'application/sql',
                'Content-Disposition': `attachment; filename="${fileName}"`,
            },
        });

    } catch (error: any) {
        console.error('Error during backup:', error);
        return NextResponse.json({ error: error.message || 'Error generating backup' }, { status: 500 });
    }
}
