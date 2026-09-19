import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { encrypt, decrypt, decryptToString } from '@/lib/encryption';
import { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sat-download/fiel
 * Guarda los archivos de la FIEL de forma encriptada.
 * Acepta: fiel_cer (Base64), fiel_key (Base64), fiel_password, rfc_contribuyente
 */
export const POST = withAuth(async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { fiel_cer_base64, fiel_key_base64, fiel_password, rfc_contribuyente } = body;

        // 1. Validar que vengan los campos obligatorios
        if (!fiel_cer_base64) {
            return NextResponse.json({ error: 'Debes seleccionar el archivo de Certificado (.cer) de tu FIEL' }, { status: 400 });
        }
        if (!fiel_key_base64) {
            return NextResponse.json({ error: 'Debes seleccionar el archivo de Llave Privada (.key) de tu FIEL' }, { status: 400 });
        }
        if (!fiel_password || typeof fiel_password !== 'string' || fiel_password.trim() === '') {
            return NextResponse.json({ error: 'Debes ingresar la contraseña de la FIEL' }, { status: 400 });
        }

        const cerBuffer = Buffer.from(fiel_cer_base64, 'base64');
        const keyBuffer = Buffer.from(fiel_key_base64, 'base64');

        if (cerBuffer.length === 0) {
            return NextResponse.json({ error: 'El archivo .cer está vacío' }, { status: 400 });
        }
        if (keyBuffer.length === 0) {
            return NextResponse.json({ error: 'El archivo .key está vacío' }, { status: 400 });
        }

        // 2. Importar utilidades criptográficas del SAT
        const { Certificate, PrivateKey, Credential } = await import('@nodecfdi/credentials/node');
        const { Fiel } = await import('@nodecfdi/sat-ws-descarga-masiva');

        // 3. Validar Certificado (.cer)
        let certificate: any;
        try {
            certificate = new Certificate(cerBuffer.toString('binary'));
        } catch (err: any) {
            return NextResponse.json({
                error: `El archivo .cer no es un certificado X.509 válido o está dañado: ${err.message || ''}`
            }, { status: 422 });
        }

        // 3.1. Validar que sea FIEL y NO CSD (Sello Digital de facturación)
        try {
            if (typeof certificate.satType === 'function') {
                const satType = certificate.satType();
                if (typeof satType.isFiel === 'function' && !satType.isFiel()) {
                    return NextResponse.json({
                        error: 'El archivo .cer corresponde a un Certificado de Sello Digital (CSD). Para conectarse a los servicios del SAT es indispensable utilizar la e.firma (FIEL), no el sello digital.'
                    }, { status: 422 });
                }
            }
        } catch {
            // Si la verificación de tipo SAT falla por versión, continuar con validación de fechas
        }

        // 3.2. Validar vigencia del certificado
        const now = new Date();
        const validTo: Date | null = typeof certificate.validTo === 'function' ? certificate.validTo() : null;
        const validFrom: Date | null = typeof certificate.validFrom === 'function' ? certificate.validFrom() : null;

        if (validTo && now > validTo) {
            const fechaExp = validTo.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
            return NextResponse.json({
                error: `El certificado de la FIEL ha caducado el ${fechaExp}. Debes renovar tu e.firma ante el SAT.`
            }, { status: 422 });
        }

        if (validFrom && now < validFrom) {
            const fechaIni = validFrom.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
            return NextResponse.json({
                error: `El certificado de la FIEL aún no entra en vigor (será válido a partir del ${fechaIni}).`
            }, { status: 422 });
        }

        // 4. Validar Llave Privada (.key) y Contraseña
        let privateKey: any;
        try {
            privateKey = new PrivateKey(keyBuffer.toString('binary'), fiel_password);
        } catch (err: any) {
            return NextResponse.json({
                error: 'La contraseña de la FIEL es incorrecta o la llave privada (.key) no pudo ser descifrada con la contraseña proporcionada.'
            }, { status: 422 });
        }

        // 5. Validar que la Llave Privada (.key) pertenezca al Certificado (.cer)
        try {
            let coincide = false;
            if (typeof privateKey.belongsTo === 'function') {
                coincide = privateKey.belongsTo(certificate);
            } else if (typeof privateKey.belongsToPEMCertificate === 'function' && typeof certificate.pem === 'function') {
                coincide = privateKey.belongsToPEMCertificate(certificate.pem());
            }

            if (!coincide) {
                return NextResponse.json({
                    error: 'La llave privada (.key) no corresponde al certificado (.cer) seleccionado. Asegúrate de subir el par de archivos de la misma e.firma.'
                }, { status: 422 });
            }
        } catch (err: any) {
            return NextResponse.json({
                error: `Error al comprobar la compatibilidad entre el certificado y la llave: ${err.message || ''}`
            }, { status: 422 });
        }

        // 6. Validar RFC
        const certRfc = (typeof certificate.rfc === 'function' ? (certificate.rfc() || '') : '').trim().toUpperCase();
        const userRfc = (rfc_contribuyente || '').trim().toUpperCase();

        if (userRfc && certRfc && userRfc !== certRfc) {
            return NextResponse.json({
                error: `El RFC capturado (${userRfc}) no coincide con el RFC del certificado de la FIEL (${certRfc}).`
            }, { status: 422 });
        }

        const rfcFinal = certRfc || userRfc;
        if (!rfcFinal) {
            return NextResponse.json({
                error: 'No fue posible extraer el RFC del certificado. Por favor indica el RFC del contribuyente manualmente.'
            }, { status: 422 });
        }

        // 7. Prueba final de firma
        try {
            const credential = new Credential(certificate, privateKey);
            const fielInstance = new Fiel(credential);
            const testSign = fielInstance.sign('test-auth-token-validation', 'sha256');
            if (!testSign) {
                throw new Error('Firma de prueba vacía');
            }
        } catch (err: any) {
            return NextResponse.json({
                error: `No se pudo generar la firma de prueba con los datos de la FIEL: ${err.message || ''}`
            }, { status: 422 });
        }

        // 8. Encriptar con AES-256-GCM
        const encCer = encrypt(cerBuffer);
        const encKey = encrypt(keyBuffer);
        const encPass = encrypt(fiel_password);

        // 9. Guardar en Settings (upsert)
        const saves = [
            ['fiel_cer', encCer],
            ['fiel_key', encKey],
            ['fiel_password', encPass],
            ['rfc_contribuyente', rfcFinal],
        ];

        for (const [k, v] of saves) {
            await pool.query(
                `INSERT INTO Settings (setting_key, setting_value) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE setting_value = ?`,
                [k, v, v]
            );
        }

        const razonSocial = typeof certificate.legalName === 'function' ? certificate.legalName() : null;

        return NextResponse.json({
            message: 'FIEL validada y guardada correctamente',
            rfc: rfcFinal,
            razon_social: razonSocial
        });
    } catch (error: any) {
        console.error('[FIEL Save] Error inesperado:', {
            message: error?.message,
            name: error?.name,
            stack: error?.stack,
            code: error?.code,
        });
        return NextResponse.json({
            error: error?.message || 'Error interno al guardar la FIEL',
            _debug: process.env.NODE_ENV !== 'production' ? error?.stack : undefined
        }, { status: 500 });
    }
});

/**
 * GET /api/sat-download/fiel
 * Retorna el estado de la FIEL (si está configurada o no) y el RFC.
 * NUNCA retorna los archivos ni la contraseña.
 */
export const GET = withAuth(async function GET() {
    try {
        const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT setting_key, setting_value FROM Settings 
             WHERE setting_key IN ('fiel_cer', 'fiel_key', 'fiel_password', 'rfc_contribuyente')`
        );

        const settings: Record<string, string> = {};
        rows.forEach(r => { settings[r.setting_key] = r.setting_value; });

        const tieneConfiguracion = !!(settings['fiel_cer'] && settings['fiel_key'] && settings['fiel_password']);

        let fielVigente = false;
        let rfcFiel = '';

        if (tieneConfiguracion) {
            try {
                const { Fiel } = await import('@nodecfdi/sat-ws-descarga-masiva');
                const { decrypt: dec, decryptToString: decStr } = await import('@/lib/encryption');
                const cerBuf = dec(settings['fiel_cer']);
                const keyBuf = dec(settings['fiel_key']);
                const pass = decStr(settings['fiel_password']);
                const fiel = Fiel.create(cerBuf.toString('binary'), keyBuf.toString('binary'), pass);
                fielVigente = fiel.isValid();
                rfcFiel = settings['rfc_contribuyente'] || '';
            } catch {
                fielVigente = false;
            }
        }

        return NextResponse.json({
            configurada: tieneConfiguracion,
            vigente: fielVigente,
            rfc: rfcFiel || settings['rfc_contribuyente'] || null
        });
    } catch (error: any) {
        console.error('[FIEL Status] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

/**
 * DELETE /api/sat-download/fiel
 * Elimina los datos de la FIEL de la BD.
 */
export const DELETE = withAuth(async function DELETE() {
    try {
        await pool.query(
            `DELETE FROM Settings WHERE setting_key IN ('fiel_cer', 'fiel_key', 'fiel_password')`
        );
        return NextResponse.json({ message: 'Datos de la FIEL eliminados' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
