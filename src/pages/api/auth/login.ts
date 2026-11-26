import type { APIRoute } from 'astro';
import { createSession, isSameOrigin, verifyDashboardPassword } from '../../../lib/auth';
import { readJson, record } from '../../../lib/http';

export const POST: APIRoute = async ({ request, clientAddress }) => {
    if (!isSameOrigin(request)) return new Response('Forbidden', { status: 403 });
    let body: Record<string, unknown>;
    try { body = record(await readJson(request, 16 * 1024)); }
    catch { return new Response('Invalid request.', { status: 400 }); }
    if (typeof body.password !== 'string' || body.password.length > 1024) return new Response('Invalid password.', { status: 400 });
    if (!await verifyDashboardPassword(body.password, clientAddress)) return new Response('Login failed. Try again later.', { status: 401 });
    const session = createSession();
    return new Response(null, { status: 204, headers: { 'Set-Cookie': session.cookie, 'Cache-Control': 'no-store' } });
};
