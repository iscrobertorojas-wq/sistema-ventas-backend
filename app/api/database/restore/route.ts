import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import path from 'path';
import os from 'os';

const execPromise = promisify(exec);

export async function POST(request: Request) {
    let tempFilePath = '';
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        tempFilePath = path.join(os.tmpdir(), `restore-${Date.now()}.sql`);
        await writeFile(tempFilePath, buffer);

        const dbHost = process.env.DB_HOST;
        const dbUser = process.env.DB_USER;
        const dbPassword = process.env.DB_PASSWORD;
        const dbName = process.env.DB_NAME;

        // Path to mysql.exe - using the Server 5.7 path
        const mysqlPath = '"C:\\Program Files\\MySQL\\MySQL Server 5.7\\bin\\mysql.exe"';

        // Command to restore database
        const command = `${mysqlPath} -h ${dbHost} -u ${dbUser} -p${dbPassword} ${dbName} < "${tempFilePath}"`;

        const { stderr } = await execPromise(command);

        if (stderr && !stderr.includes('Warning')) {
            console.error('mysql restore stderr:', stderr);
            throw new Error(stderr);
        }

        return NextResponse.json({ message: 'Base de datos restaurada correctamente' });

    } catch (error: any) {
        console.error('Error during restore:', error);
        return NextResponse.json({ error: error.message || 'Error restoring database' }, { status: 500 });
    } finally {
        if (tempFilePath) {
            try {
                await unlink(tempFilePath);
            } catch (err) {
                console.error('Error deleting temp file:', err);
            }
        }
    }
}
