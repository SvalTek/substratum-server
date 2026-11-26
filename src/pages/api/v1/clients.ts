import type { APIRoute } from 'astro';
import { burnClient, clientId, issueClient, listClients, rerollClient } from '../../../lib/clients';
import { jsonResponse, readJson, record } from '../../../lib/http';

const forbidden = () => jsonResponse({ error: 'Management access required.' }, 403);

export const GET: APIRoute = ({ locals }) => locals.auth && locals.auth.method !== 'client'
    ? jsonResponse({ clients: listClients() })
    : forbidden();

export const POST: APIRoute = async ({ request, locals }) => {
    if (!locals.auth || locals.auth.method === 'client') return forbidden();

    let id: string;
    let operation: unknown;
    try {
        const body = record(await readJson(request, 4096));
        id = clientId(body.clientId);
        operation = body.operation;
    } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : 'Invalid client request.' }, 400);
    }

    switch (operation) {
        case 'issue': {
            const credentials = issueClient(id);
            return credentials
                ? jsonResponse(credentials, 201)
                : jsonResponse({ error: 'That client ID already exists.' }, 409);
        }
        case 'reroll': {
            const credentials = rerollClient(id);
            return credentials ? jsonResponse(credentials) : jsonResponse({ error: 'Client does not exist.' }, 404);
        }
        case 'burn':
            return burnClient(id)
                ? new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
                : jsonResponse({ error: 'Client does not exist.' }, 404);
        default:
            return jsonResponse({ error: 'Operation must be issue, reroll or burn.' }, 400);
    }
};
