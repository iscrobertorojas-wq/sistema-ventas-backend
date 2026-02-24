-- Migration: Add Service Policies tables
-- Run this script against the service_sales_db database

USE service_sales_db;

CREATE TABLE IF NOT EXISTS ServicePolicies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_id INT NOT NULL,
    policy_number VARCHAR(100) NOT NULL UNIQUE,
    date DATE NOT NULL,
    total_hours DECIMAL(6,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES Clients(id)
);

CREATE TABLE IF NOT EXISTS PolicyServiceRecords (
    id INT AUTO_INCREMENT PRIMARY KEY,
    policy_id INT NOT NULL,
    service_date DATE NOT NULL,
    description TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    duration_minutes INT NOT NULL,
    service_type ENUM('Remoto','Presencial') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (policy_id) REFERENCES ServicePolicies(id) ON DELETE CASCADE
);
