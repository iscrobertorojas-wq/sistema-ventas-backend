import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const connection = await pool.getConnection();
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
            // With multipleStatements: true, we can execute the entire script at once
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
        connection.release();
    }
}
