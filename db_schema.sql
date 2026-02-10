CREATE DATABASE IF NOT EXISTS service_sales_db;
USE service_sales_db;

CREATE TABLE IF NOT EXISTS Clients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    address VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Services (
    id INT AUTO_INCREMENT PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Sales (
    id INT AUTO_INCREMENT PRIMARY KEY,
    folio VARCHAR(50) UNIQUE NOT NULL,
    client_id INT NOT NULL,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    type ENUM('Remission', 'Invoice') DEFAULT 'Remission',
    status ENUM('Pending', 'Paid', 'Partial') DEFAULT 'Pending',
    total DECIMAL(10, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES Clients(id)
);

CREATE TABLE IF NOT EXISTS SaleItems (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    service_id INT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sale_id) REFERENCES Sales(id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES Services(id)
);

CREATE TABLE IF NOT EXISTS Payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    method ENUM('Cash', 'Check', 'Transfer') NOT NULL,
    bank_account VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sale_id) REFERENCES Sales(id) ON DELETE CASCADE
);

-- Settings Table
CREATE TABLE IF NOT EXISTS Settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert default settings
INSERT INTO Settings (setting_key, setting_value) VALUES 
    ('folio_remission', '1'),
    ('folio_invoice', '1'),
    ('theme', 'light')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
