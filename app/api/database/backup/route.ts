import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execPromise = promisify(exec);

export async function GET() {
    try {
        const dbHost = process.env.DB_HOST;
        const dbUser = process.env.DB_USER;
        const dbPassword = process.env.DB_PASSWORD;
        const dbName = process.env.DB_NAME;

        // Path to mysqldump - using the one found during research
        const mysqldumpPath = '"C:\\Program Files\\MySQL\\MySQL Server 5.7\\bin\\mysqldump.exe"';

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `backup-${dbName}-${timestamp}.sql`;

        // Command to execute mysqldump
        // We use -p${dbPassword} without space as per mysql requirements
        const command = `${mysqldumpPath} -h ${dbHost} -u ${dbUser} -p${dbPassword} ${dbName}`;

        const { stdout, stderr } = await execPromise(command, { maxBuffer: 1024 * 1024 * 50 }); // 50MB buffer

        if (stderr && !stderr.includes('Warning')) {
            console.error('mysqldump stderr:', stderr);
            throw new Error(stderr);
        }

        return new NextResponse(stdout, {
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
