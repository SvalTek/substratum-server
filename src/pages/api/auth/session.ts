import type { APIRoute } from 'astro';
import { jsonResponse } from '../../../lib/http';

export const GET: APIRoute = ({ locals }) => jsonResponse({ authenticated: true, method: locals.auth?.method ?? 'session' });
