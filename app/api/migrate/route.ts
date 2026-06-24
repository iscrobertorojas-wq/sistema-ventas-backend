import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const GET = async function GET() {
    try {
        const connection = await pool.getConnection();

        // Add observations column (if not exists - though the previous version was just a raw ALTER)
        try {
            await connection.query('ALTER TABLE Sales ADD COLUMN observations TEXT AFTER total;');
        } catch (e) {
            console.log('Column observations might already exist');
        }

        // Add currency column to Quotations
        try {
            await connection.query("ALTER TABLE Quotations ADD COLUMN currency VARCHAR(10) DEFAULT 'MXN' AFTER iva_mode;");
        } catch (e) {
            console.log('Column currency might already exist');
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

        // Create Quotations table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS Quotations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                folio VARCHAR(50) UNIQUE NOT NULL,
                client_id INT NOT NULL,
                date DATETIME DEFAULT CURRENT_TIMESTAMP,
                iva_mode ENUM('none', 'add', 'breakdown') DEFAULT 'none',
                subtotal DECIMAL(12,2) DEFAULT 0.00,
                iva DECIMAL(12,2) DEFAULT 0.00,
                total DECIMAL(12,2) DEFAULT 0.00,
                observations TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES Clients(id)
            )
        `);

        // Create QuotationItems table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS QuotationItems (
                id INT AUTO_INCREMENT PRIMARY KEY,
                quotation_id INT NOT NULL,
                description VARCHAR(500) NOT NULL,
                unit_price DECIMAL(12,2) NOT NULL,
                quantity INT DEFAULT 1,
                discount_percent DECIMAL(5,2) DEFAULT 0.00,
                amount DECIMAL(12,2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (quotation_id) REFERENCES Quotations(id) ON DELETE CASCADE
            )
        `);

        // Add folio_quotation setting
        await connection.query(`
            INSERT IGNORE INTO Settings (setting_key, setting_value) 
            VALUES ('folio_quotation', '1')
        `);

        // Create ContpaqiProducts table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS ContpaqiProducts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                description VARCHAR(255) NOT NULL,
                price DECIMAL(10, 2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create ContpaqiLicenses table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS ContpaqiLicenses (
                id INT AUTO_INCREMENT PRIMARY KEY,
                serial_number VARCHAR(100) NOT NULL UNIQUE,
                client_id INT NOT NULL,
                product_id INT NOT NULL,
                users_count INT NOT NULL DEFAULT 1,
                expiration_date DATE NOT NULL,
                contact_name VARCHAR(255) NOT NULL,
                contact_phone VARCHAR(50) NOT NULL,
                is_renewed_current_year TINYINT(1) DEFAULT 0,
                renewal_date DATE DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES Clients(id),
                FOREIGN KEY (product_id) REFERENCES ContpaqiProducts(id) ON DELETE CASCADE
            )
        `);

        connection.release();
        return NextResponse.json({ message: 'Migration successful: Contpaqi and other tables created' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
};
