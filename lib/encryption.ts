import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
    const rawKey = (process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'sistema-ventas-sat-encryption-key-salt-2026').trim();
    
    // Si ya es un hex de 64 caracteres (256 bits), usarlo directamente
    if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
        return Buffer.from(rawKey, 'hex');
    }
    
    // Si no es un hex de 64 caracteres, derivar una llave de 256 bits determinista con SHA-256
    return crypto.createHash('sha256').update(rawKey).digest();
}

/**
 * Encripta datos binarios o texto con AES-256-GCM.
 * Retorna una cadena en formato: iv:authTag:ciphertext (todo en hex).
 */
export function encrypt(data: string | Buffer): string {
    const key = getKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const input = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Desencripta una cadena previamente encriptada con `encrypt()`.
 * Retorna Buffer para datos binarios (cer, key) o string para texto.
 */
export function decrypt(encryptedStr: string): Buffer {
    const key = getKey();
    const parts = encryptedStr.split(':');
    if (parts.length !== 3) {
        throw new Error('[Encryption] Formato inválido de datos encriptados.');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const ciphertext = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Desencripta y retorna como string UTF-8 (para contraseñas o texto).
 */
export function decryptToString(encryptedStr: string): string {
    return decrypt(encryptedStr).toString('utf-8');
}
