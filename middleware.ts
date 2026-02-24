import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    // Check if the request is for the API
    if (request.nextUrl.pathname.startsWith('/api')) {
        const origin = request.headers.get('origin');
        const response = NextResponse.next();

        // Set CORS headers dynamically
        if (origin) {
            response.headers.set('Access-Control-Allow-Origin', origin);
        } else {
            response.headers.set('Access-Control-Allow-Origin', '*');
        }

        response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        response.headers.set('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
        response.headers.set('Access-Control-Allow-Credentials', 'true');

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
