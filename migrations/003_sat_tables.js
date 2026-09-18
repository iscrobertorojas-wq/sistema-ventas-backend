module.exports = {
    async up(connection) {
        // --- Tabla: SatDownloadRequests ---
        // Guarda el historial de solicitudes de descarga al SAT
        await connection.query(`
            CREATE TABLE IF NOT EXISTS SatDownloadRequests (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                request_id      VARCHAR(100) NULL COMMENT 'ID de solicitud devuelto por el SAT',
                tipo            ENUM('emitidos','recibidos') NOT NULL,
                fecha_inicio    DATE NOT NULL,
                fecha_fin       DATE NOT NULL,
                estado          ENUM('pendiente','verificando','listo','descargado','error') NOT NULL DEFAULT 'pendiente',
                paquetes        TEXT NULL COMMENT 'JSON array de IDs de paquetes disponibles para descarga',
                total_cfdis     INT NULL COMMENT 'Número total de CFDIs reportados por el SAT',
                mensaje_error   TEXT NULL,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
        `);

        // --- Tabla: SatCfdis ---
        // Almacena cada CFDI (XML) descargado del SAT para futuros cálculos fiscales
        await connection.query(`
            CREATE TABLE IF NOT EXISTS SatCfdis (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                request_id      INT NOT NULL COMMENT 'FK a SatDownloadRequests',
                uuid            VARCHAR(36) NOT NULL UNIQUE COMMENT 'UUID del CFDI (folio fiscal)',
                tipo            ENUM('emitido','recibido') NOT NULL,
                rfc_emisor      VARCHAR(20) NOT NULL,
                nombre_emisor   VARCHAR(255) NULL,
                rfc_receptor    VARCHAR(20) NOT NULL,
                nombre_receptor VARCHAR(255) NULL,
                fecha_emision   DATETIME NULL,
                subtotal        DECIMAL(14,6) NULL,
                iva             DECIMAL(14,6) NULL,
                total           DECIMAL(14,6) NULL,
                moneda          VARCHAR(10) NULL,
                tipo_cfdi       VARCHAR(30) NULL COMMENT 'Ingreso, Egreso, Traslado, Nomina, Pago',
                metodo_pago     VARCHAR(10) NULL,
                forma_pago      VARCHAR(10) NULL,
                uso_cfdi        VARCHAR(10) NULL,
                estado_sat      VARCHAR(20) NULL COMMENT 'Vigente, Cancelado',
                xml_content     LONGTEXT NULL COMMENT 'Contenido XML completo encriptado con AES-256',
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_tipo (tipo),
                INDEX idx_fecha (fecha_emision),
                INDEX idx_rfc_emisor (rfc_emisor),
                INDEX idx_rfc_receptor (rfc_receptor),
                INDEX idx_request (request_id),
                FOREIGN KEY (request_id) REFERENCES SatDownloadRequests(id) ON DELETE CASCADE
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
        `);

        console.log('    -> Tablas SatDownloadRequests y SatCfdis creadas.');
    }
};
