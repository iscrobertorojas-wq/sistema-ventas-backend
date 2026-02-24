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

        const sqlContent = await file.text();

        // Split by semicolons followed by newlines to roughly separate statements
        // This works for most standard dumps and the one we generate
        const statements = sqlContent
            .split(/;\s*\n/)
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'));

        await connection.beginTransaction();

        for (const statement of statements) {
            // Re-add the semicolon if it was removed by split but is needed for execution
            // mysql2 doesn't actually need the trailing semicolon for individual queries
            try {
                await connection.query(statement);
            } catch (err: any) {
                console.error(`Error executing statement: ${statement.substring(0, 50)}...`, err);
                throw new Error(`Error en la sentencia SQL: ${err.message}`);
            }
        }

        await connection.commit();

        return NextResponse.json({ message: 'Base de datos restaurada correctamente' });

    } catch (error: any) {
        await connection.rollback();
        console.error('Error during restore:', error);
        return NextResponse.json({ error: error.message || 'Error al restaurar la base de datos' }, { status: 500 });
    } finally {
        connection.release();
    }
}
