-- Migration: Add Contpaqi modules
-- Run this script against the service_sales_db database

USE service_sales_db;

-- 1. Table for Contpaqi Products
CREATE TABLE IF NOT EXISTS ContpaqiProducts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Table for Contpaqi Licenses Expiration control
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
);
