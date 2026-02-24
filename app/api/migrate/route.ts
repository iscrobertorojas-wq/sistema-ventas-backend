import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET() {
    try {
        const connection = await pool.getConnection();

        // Add observations column (if not exists - though the previous version was just a raw ALTER)
        try {
            await connection.query('ALTER TABLE Sales ADD COLUMN observations TEXT AFTER total;');
        } catch (e) {
            console.log('Column observations might already exist');
        }

        // Create Users table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS Users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        connection.release();
        return NextResponse.json({ message: 'Migration successful: Users table created and Sales updated' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
