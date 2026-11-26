import type { APIRoute } from 'astro';
import { destroySession } from '../../../lib/auth';
import { jsonResponse } from '../../../lib/http';

export const POST: APIRoute = ({ request, locals }) => {
    const cookie = destroySession(request);
    return jsonResponse({ ok: true }, 200, locals.auth?.method === 'session' ? { 'Set-Cookie': cookie } : undefined);
};
