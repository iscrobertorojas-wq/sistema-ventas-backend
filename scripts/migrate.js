const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// Load environment variables from .env.local if present
const envPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const val = match[2].trim();
            if (!process.env[key]) {
                process.env[key] = val;
            }
        }
    });
}

async function runMigrations() {
    console.log('[Migrator] Iniciando proceso de migraciones automáticas...');
    
    if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
        console.error('[Migrator] Faltan variables de entorno para la base de datos. Saltando migraciones.');
        return;
    }

    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
        });

        // 1. Create _migrations table if it doesn't exist
        await connection.query(`
            CREATE TABLE IF NOT EXISTS _migrations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) UNIQUE NOT NULL,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. Read executed migrations
        const [rows] = await connection.query(`SELECT name FROM _migrations`);
        const executedMigrations = new Set(rows.map(r => r.name));

        // 3. Find migration files
        const migrationsDir = path.join(__dirname, '../migrations');
        if (!fs.existsSync(migrationsDir)) {
            fs.mkdirSync(migrationsDir);
        }

        const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.js'))
            .sort();

        // 4. Execute pending migrations
        let executedCount = 0;
        for (const file of files) {
            if (!executedMigrations.has(file)) {
                console.log(`[Migrator] Ejecutando migración: ${file}`);
                try {
                    const migration = require(path.join(migrationsDir, file));
                    if (typeof migration.up === 'function') {
                        await migration.up(connection);
                    }
                    
                    await connection.query(`INSERT INTO _migrations (name) VALUES (?)`, [file]);
                    console.log(`[Migrator] Migración ${file} ejecutada exitosamente.`);
                    executedCount++;
                } catch (err) {
                    console.error(`[Migrator] Error ejecutando ${file}:`, err);
                    throw err; // Stop process on failure
                }
            }
        }

        if (executedCount === 0) {
            console.log('[Migrator] La base de datos ya está actualizada. No hay migraciones pendientes.');
        } else {
            console.log(`[Migrator] ${executedCount} migraciones ejecutadas con éxito.`);
        }

    } catch (err) {
        console.error('[Migrator] Error crítico en el proceso de migración:', err);
        process.exit(1); // Fail the build if migrations fail
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

runMigrations();
