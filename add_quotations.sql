-- Quotations Module Tables
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
);

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
);

-- Setting for quotation folio counter
INSERT INTO Settings (setting_key, setting_value) VALUES ('folio_quotation', '1')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
