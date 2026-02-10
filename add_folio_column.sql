-- Migration script to add folio column and settings
USE service_sales_db;

-- Add folio column to Sales table if it doesn't exist
ALTER TABLE Sales 
ADD COLUMN folio VARCHAR(50) UNIQUE NOT NULL DEFAULT 'TEMP' AFTER id;

-- Update existing sales with temporary folios based on their ID
UPDATE Sales SET folio = CONCAT('R-', LPAD(id, 6, '0')) WHERE folio = 'TEMP';

-- Add folio settings if they don't exist
INSERT INTO Settings (setting_key, setting_value) VALUES 
    ('folio_remission', '1'),
    ('folio_invoice', '1')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- Update folio counters based on existing sales
UPDATE Settings 
SET setting_value = (
    SELECT COALESCE(MAX(CAST(SUBSTRING(folio, 3) AS UNSIGNED)), 0) + 1 
    FROM Sales 
    WHERE folio LIKE 'R-%'
)
WHERE setting_key = 'folio_remission';

UPDATE Settings 
SET setting_value = (
    SELECT COALESCE(MAX(CAST(SUBSTRING(folio, 3) AS UNSIGNED)), 0) + 1 
    FROM Sales 
    WHERE folio LIKE 'F-%'
)
WHERE setting_key = 'folio_invoice';
