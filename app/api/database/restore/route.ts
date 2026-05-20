import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import mysql from 'mysql2/promise';
import { withAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async function POST(request: Request) {
    // Create a temporary connection with multipleStatements enabled just for this restore
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306'),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'admin',
        database: process.env.DB_NAME || 'service_sales_db',
        multipleStatements: true,
        ssl: process.env.DB_HOST && process.env.DB_HOST !== 'localhost' ? {
            minVersion: 'TLSv1.2',
            rejectUnauthorized: true
        } : undefined
    });

    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No se proporcionó ningún archivo' }, { status: 400 });
        }

        let sqlContent = await file.text();

        // Wrap everything in foreign key check disables to prevent dependency errors during restore
        const finalSql = `
            SET FOREIGN_KEY_CHECKS=0;
            ${sqlContent}
            SET FOREIGN_KEY_CHECKS=1;
        `;

        await connection.beginTransaction();

        try {
            await connection.query(finalSql);
            await connection.commit();
        } catch (err: any) {
            await connection.rollback();
            throw err;
        }

        return NextResponse.json({ message: 'Base de datos restaurada correctamente' });

    } catch (error: any) {
        console.error('Error during restore:', error);
        return NextResponse.json({
            error: `Error al restaurar: ${error.message}`,
            details: 'Asegúrate de que el archivo sea un respaldo válido generado por el sistema.'
        }, { status: 500 });
    } finally {
        await connection.end();
    }
});
