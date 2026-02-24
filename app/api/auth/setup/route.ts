import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import bcrypt from 'bcryptjs';
import { RowDataPacket } from 'mysql2';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { password } = body;

        if (!password) {
            return NextResponse.json({ error: 'Password is required' }, { status: 400 });
        }

        // Ensure table exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS Users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Check if user already exists
        const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) as count FROM Users');
        if (rows[0].count > 0) {
            return NextResponse.json({ error: 'Setup already completed' }, { status: 400 });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const email = 'iscroberto.rojas@gmail.com';

        await pool.query(
            'INSERT INTO Users (email, password) VALUES (?, ?)',
            [email, hashedPassword]
        );

        return NextResponse.json({ message: 'Setup successful' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
