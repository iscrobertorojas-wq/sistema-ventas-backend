import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const [rows] = await pool.query<RowDataPacket[]>(
            'SELECT setting_key, setting_value FROM Settings'
        );

        const settings: { [key: string]: string } = {};
        rows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });

        return NextResponse.json(settings);
    } catch (error: any) {
        console.error('Error fetching settings:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    try {
        const body = await request.json();
        const { setting_key, setting_value } = body;

        console.log(`Updating setting: ${setting_key} = ${setting_value}`);

        if (!setting_key || setting_value === undefined) {
            return NextResponse.json(
                { error: 'setting_key and setting_value are required' },
                { status: 400 }
            );
        }

        const trimmedValue = String(setting_value).trim();

        await pool.query(
            'INSERT INTO Settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [setting_key, trimmedValue, trimmedValue]
        );

        console.log(`Setting ${setting_key} updated successfully to: ${trimmedValue}`);
        return NextResponse.json({ message: 'Setting updated successfully' });
    } catch (error: any) {
        console.error('Error updating setting:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
