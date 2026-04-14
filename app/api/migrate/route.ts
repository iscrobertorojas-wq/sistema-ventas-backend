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

        // Create Suppliers table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS Suppliers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(50),
                address VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create Purchases table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS Purchases (
                id INT AUTO_INCREMENT PRIMARY KEY,
                supplier_id INT NOT NULL,
                date DATETIME DEFAULT CURRENT_TIMESTAMP,
                total DECIMAL(10, 2) DEFAULT 0.00,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (supplier_id) REFERENCES Suppliers(id)
            )
        `);

        // Create PurchaseItems table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS PurchaseItems (
                id INT AUTO_INCREMENT PRIMARY KEY,
                purchase_id INT NOT NULL,
                description VARCHAR(500) NOT NULL,
                cost DECIMAL(10, 2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (purchase_id) REFERENCES Purchases(id) ON DELETE CASCADE
            )
        `);

        connection.release();
        return NextResponse.json({ message: 'Migration successful: Suppliers, Purchases and PurchaseItems tables created' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
