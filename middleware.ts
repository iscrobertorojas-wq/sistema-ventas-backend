import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    // Check if the request is for the API
    if (request.nextUrl.pathname.startsWith('/api')) {
        const response = NextResponse.next();

        // Set CORS headers
        response.headers.set('Access-Control-Allow-Origin', '*'); // Or 'http://localhost:4200' for stricter security
        response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        // Handle preflight requests
        if (request.method === 'OPTIONS') {
            return new NextResponse(null, {
                status: 200,
                headers: response.headers,
            });
        }

        return response;
    }

    return NextResponse.next();
}

export const config = {
    matcher: '/api/:path*',
};
