import { defineMiddleware } from 'astro:middleware';
import { authenticate, isSameOrigin } from './lib/auth';
import { getConfig } from './lib/config';
import { principalContext } from './lib/principal';

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const openPaths = new Set(['/login', '/api/auth/login', '/api/v1/health']);

export const onRequest = defineMiddleware(async (context, next) => {
    const pathname = new URL(context.request.url).pathname;
    if (openPaths.has(pathname) || pathname.startsWith('/_astro/') || pathname === '/favicon.svg' || pathname === '/favicon.ico') {
        return secure(await next(), context.request);
    }

    const auth = authenticate(context.request);
    if (!auth) {
        if (pathname.startsWith('/api/')) return secure(new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401, headers: jsonHeaders }), context.request);
        const loginOrigin = getConfig().publicOrigin ?? context.request.url;
        return secure(Response.redirect(new URL('/login', loginOrigin), 303), context.request);
    }
    context.locals.auth = auth;
    if (auth.method === 'client' && !pathname.startsWith('/api/v1/')) {
        return secure(new Response(JSON.stringify({ error: 'Management access required.' }), { status: 403, headers: jsonHeaders }), context.request);
    }

    const method = context.request.method.toUpperCase();
    if (auth.method === 'session' && !['GET', 'HEAD', 'OPTIONS'].includes(method) && !isSameOrigin(context.request)) {
        return secure(new Response(JSON.stringify({ error: 'Origin check failed.' }), { status: 403, headers: jsonHeaders }), context.request);
    }
    return secure(await principalContext.run(auth.principal, next), context.request);
});

function secure(response: Response, request: Request): Response {
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (new URL(request.url).protocol === 'https:' || getConfig().cookieSecure) headers.set('Strict-Transport-Security', 'max-age=31536000');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
