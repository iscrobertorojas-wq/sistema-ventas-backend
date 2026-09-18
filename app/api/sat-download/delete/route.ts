import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';

export const DELETE = withAuth(async function DELETE(request) {
    try {
        const body = await request.json();
        const { id } = body;

        if (!id) {
            return NextResponse.json({ error: 'id es requerido' }, { status: 400 });
        }

        // Verificar que existe
        const [rows] = await pool.query<RowDataPacket[]>(
            'SELECT id, estado FROM SatDownloadRequests WHERE id = ?',
            [id]
        );
        if (!rows || rows.length === 0) {
            return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 });
        }

        const solicitud = rows[0];

        // No se puede eliminar si está en proceso activo (verificando)
        if (solicitud.estado === 'verificando') {
            return NextResponse.json(
                { error: 'No se puede eliminar una solicitud que está siendo verificada en este momento. Espera a que termine.' },
                { status: 409 }
            );
        }

        // Eliminar la solicitud
        await pool.query('DELETE FROM SatDownloadRequests WHERE id = ?', [id]);

        return NextResponse.json({ message: 'Solicitud eliminada correctamente', id });

    } catch (error: any) {
        console.error('[SAT Delete] Error:', error);
        return NextResponse.json({ error: error.message || 'Error interno del servidor' }, { status: 500 });
    }
});
