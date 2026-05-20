import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

export interface AuthenticatedRequest extends NextRequest {
    user?: {
        id: number;
        email: string;
    };
}

/**
 * Authentication Wrapper for Next.js API Routes (App Router)
 */
export function withAuth(
    handler: (request: AuthenticatedRequest, ...args: any[]) => Promise<Response> | Response
) {
    return async (request: NextRequest, ...args: any[]) => {
        // 1. Guard against empty secret key in production/development
        if (!JWT_SECRET) {
            console.error('[CRITICAL] JWT_SECRET environment variable is not defined!');
            return NextResponse.json(
                { error: 'Internal Server Error: Security misconfiguration.' },
                { status: 500 }
            );
        }

        try {
            // 2. Extract Authorization header
            const authHeader = request.headers.get('Authorization');
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return NextResponse.json(
                    { error: 'No autorizado: Token de autenticación faltante' },
                    { status: 401 }
                );
            }

            const token = authHeader.split(' ')[1];

            // 3. Verify JWT token
            const decoded = jwt.verify(token, JWT_SECRET) as { id: number; email: string };

            // 4. Attach user data to request cloned interface
            const authenticatedRequest = request as AuthenticatedRequest;
            authenticatedRequest.user = decoded;

            // 5. Execute actual API route handler
            return await handler(authenticatedRequest, ...args);

        } catch (error: any) {
            console.warn('[AUTH WARNING] Authentication failed:', error.message);
            return NextResponse.json(
                { error: 'No autorizado: Token inválido o expirado' },
                { status: 401 }
            );
        }
    };
}
