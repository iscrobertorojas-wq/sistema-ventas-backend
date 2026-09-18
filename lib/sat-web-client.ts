import https from 'https';

/**
 * Cliente HTTP seguro y robusto para los servicios web del SAT.
 *
 * ESTRATEGIA: call() SIEMPRE resuelve con un CResponse (nunca rechaza).
 * Esto evita el bug "webError.getResponse is not a function" que ocurre cuando
 * ServiceConsumer.runRequest() recibe un Error plano en lugar de WebClientException.
 *
 * La librería llama a webClient.call(request) y espera:
 *   - Resolve → CResponse (caso feliz)
 *   - Reject  → WebClientException (que tenga .getResponse())
 * Al nunca rechazar, eliminamos el problema de raíz.
 * Si hay un error de red, devolvemos un CResponse con statusCode=0 y el mensaje de error.
 * La librería detectará ese body vacío/inválido y lo manejará sin crashear.
 */
export class SafeWebClient {
    private _timeout: number;
    private _agent: https.Agent;

    // Stubs requeridos por la interfaz interna de la librería
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _fireRequestFn?: (r: any) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _fireResponseFn?: (r: any) => void;

    constructor(
        timeoutMs = 60_000,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onFireRequest?: (r: any) => void,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onFireResponse?: (r: any) => void
    ) {
        this._timeout = timeoutMs;
        this._fireRequestFn = onFireRequest;
        this._fireResponseFn = onFireResponse;
        this._agent = new https.Agent({
            minVersion: 'TLSv1.2',
            rejectUnauthorized: false, // Los certificados del SAT a veces no están en las CAs de Node
            keepAlive: false,
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fireRequest(request: any): void {
        this._fireRequestFn?.(request);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fireResponse(response: any): void {
        this._fireResponseFn?.(response);
    }

    /**
     * Realiza la petición HTTP al SAT.
     * IMPORTANTE: Esta función SIEMPRE resuelve (nunca rechaza) para evitar
     * el bug webError.getResponse is not a function en ServiceConsumer.runRequest().
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async call(request: any): Promise<any> {
        const { CResponse } = await import('@nodecfdi/sat-ws-descarga-masiva');

        const uri: string = request.getUri();
        const headersMap: Record<string, string> = request.getHeaders() ?? {};
        const method: string = request.getMethod?.() || 'POST';
        const body: string = request.getBody?.() || '';

        return new Promise<InstanceType<typeof CResponse>>((resolve) => {
            let req: https.ClientRequest;
            let settled = false;

            const settle = (response: InstanceType<typeof CResponse>) => {
                if (!settled) {
                    settled = true;
                    resolve(response);
                }
            };

            const errorResponse = (msg: string) =>
                new CResponse(0, msg, {});

            try {
                req = https.request(
                    uri,
                    {
                        method,
                        headers: headersMap,
                        agent: this._agent,
                        timeout: this._timeout,
                    },
                    (res) => {
                        const chunks: Buffer[] = [];
                        res.on('data', (chunk: Buffer) => chunks.push(chunk));
                        res.on('end', () => {
                            const responseBody = Buffer.concat(chunks).toString('utf-8');
                            const statusCode = res.statusCode ?? 200;
                            console.log(`[SafeWebClient] ${method} ${uri} → ${statusCode}`);
                            settle(new CResponse(statusCode, responseBody, res.headers as Record<string, string>));
                        });
                        res.on('error', (err: Error) => {
                            console.error('[SafeWebClient] Error leyendo respuesta:', err.message);
                            settle(errorResponse(`Error al leer respuesta del SAT: ${err.message}`));
                        });
                    }
                );
            } catch (syncErr: unknown) {
                const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
                console.error('[SafeWebClient] Error síncrono creando request:', msg);
                settle(errorResponse(`Error de conexión con el SAT: ${msg}`));
                return;
            }

            req.on('error', (err: Error) => {
                console.error('[SafeWebClient] Error de red:', err.message);
                settle(errorResponse(`Error de red con el SAT: ${err.message}`));
            });

            req.on('timeout', () => {
                console.warn(`[SafeWebClient] Timeout tras ${this._timeout / 1000}s en: ${uri}`);
                req.destroy();
                settle(errorResponse(`El SAT no respondió en ${this._timeout / 1000} segundos`));
            });

            try {
                req.write(body);
                req.end();
            } catch (writeErr: unknown) {
                const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
                console.error('[SafeWebClient] Error al escribir body:', msg);
                settle(errorResponse(`Error al enviar datos al SAT: ${msg}`));
            }
        });
    }
}
