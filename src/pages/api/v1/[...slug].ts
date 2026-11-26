import type { APIRoute } from 'astro';
import type { Address, QueryOptions, Region, Vec3 } from '@svaltek/substratum';
import { MutationRejected } from '@svaltek/substratum';
import { jsonResponse, readJson, record, stringField } from '../../../lib/http';
import { getRuntime } from '../../../lib/runtime';
import { overviewMetrics, overviewStats } from '../../../lib/overview/server';
import type { AuthResult } from '../../../lib/auth';
import { registerSessionStream } from '../../../lib/auth';
import { clientCredentialIsCurrent, registerClientStream } from '../../../lib/clients';
import { cellPage, contentPage } from '../../../lib/catalog';
import { recordQuery } from '../../../lib/metrics';
import { activitySnapshot, addActivity, queryActivity, subscribeActivity } from '../../../lib/activity/journal';
import { createBackup } from '../../../lib/operations';
import { openApiSpec } from '../../../lib/openapi';

const MAX_RESULTS = 1000;
const encoder = new TextEncoder();
type ServerWorld = Awaited<ReturnType<typeof getRuntime>>['world'];

function address(world: ServerWorld, value: unknown): Address {
    if (!Array.isArray(value) || value.length !== 3) throw new TypeError('address must be an array of three binary prefixes.');
    return world.geometry.address([value[0], value[1], value[2]]);
}

function coordinates(value: unknown, label: string): Vec3 {
    if (!Array.isArray(value) || value.length !== 3) throw new TypeError(`${label} must be a three-coordinate vector.`);
    return [value[0], value[1], value[2]];
}

function region(world: ServerWorld, value: unknown): Region {
    if (value === undefined) return world.geometry.address(['', '', '']);
    if (Array.isArray(value)) {
        const candidate = value as unknown as Region;
        world.geometry.boundsOf(candidate);
        return candidate;
    }
    const candidate = record(value);
    const box = { at: coordinates(candidate.at, 'region.at'), ...(candidate.extent !== undefined ? { extent: candidate.extent as number | Vec3 } : {}) };
    world.geometry.boundsOf(box);
    return box;
}

function limit(value: unknown, fallback = 250): number {
    const result = value === undefined ? fallback : Number(value);
    if (!Number.isSafeInteger(result) || result < 1 || result > MAX_RESULTS) throw new RangeError(`limit must be an integer from 1 to ${MAX_RESULTS}.`);
    return result;
}

function queryOptions(body: Record<string, unknown>) {
    const options: Record<string, unknown> = {};
    if (body.kind !== undefined) options.kind = stringField(body.kind, 'kind');
    if (body.where !== undefined) options.where = record(body.where);
    if (body.tags !== undefined) {
        if (!Array.isArray(body.tags) || body.tags.length > 32 || body.tags.some(tag => typeof tag !== 'string' || tag.length > 128)) {
            throw new TypeError('tags must be an array of up to 32 strings of at most 128 characters.');
        }
        options.tags = body.tags;
    }
    if (body.where !== undefined && Object.keys(options.where as object).length > 32) throw new TypeError('where may contain at most 32 fields.');
    if (body.overlap !== undefined) {
        if (typeof body.overlap !== 'boolean') throw new TypeError('overlap must be a boolean.');
        options.overlap = body.overlap;
    }
    return options as QueryOptions<Record<string, unknown>, string>;
}

function withLimit<T>(items: Iterable<T>, maximum: number): T[] {
    const result: T[] = [];
    for (const item of items) {
        if (result.length >= maximum) break;
        result.push(item);
    }
    return result;
}

function queryResponse(run: () => unknown): Response {
    const start = performance.now();
    const result = run();
    const duration = performance.now() - start;
    recordQuery(duration);
    return jsonResponse(result, 200, { 'Server-Timing': `query;dur=${duration.toFixed(3)}`, 'X-Query-Time-Ms': duration.toFixed(3) });
}

export const GET: APIRoute = ({ params, request, locals }) => route(request, params.slug ?? '', locals.auth);
export const POST = GET;
export const PATCH = GET;
export const DELETE = GET;

async function route(request: Request, slug: string, auth?: AuthResult): Promise<Response> {
    try {
        const path = `/api/v1/${slug}`.replace(/\/$/, '');
        const server = await getRuntime();
        if (path === '/api/v1/openapi.json' && request.method === 'GET') return jsonResponse(openApiSpec);
        if (path === '/api/v1/stats' && request.method === 'GET') {
            const view = new URL(request.url).searchParams.get('view');
            if (view && auth?.method === 'client') return jsonResponse({ error: 'Management access required.' }, 403);
            if (view === 'metrics') return jsonResponse(overviewMetrics(server));
            const stats = { bits: server.world.bits, ...server.world.stats(), plugins: server.pluginNames() };
            if (view === 'overview') {
                return jsonResponse({ ...stats, ...overviewStats(server) });
            }
            return jsonResponse(stats);
        }
        if (path === '/api/v1/snapshot' && request.method === 'GET') return jsonResponse(server.snapshot());
        if (path === '/api/v1/atlas/delta' && request.method === 'POST') {
            const body = record(await readJson(request, 64 * 1024));
            if (!Array.isArray(body.addresses) || !Array.isArray(body.contentIds) ||
                body.addresses.length + body.contentIds.length > 256) {
                throw new TypeError('Atlas delta requests support up to 256 combined addresses and content IDs.');
            }
            const cells = body.addresses.flatMap(value => {
                const cell = server.world.getCell(address(server.world, value));
                return cell ? [{ ...cell, attachments: cell.attachments.map(({ id, metadata }) => ({ id, metadata })) }] : [];
            });
            const kind = server.db.query<{ kind: string }, [string]>('SELECT kind FROM contents WHERE id = ?');
            const contents = body.contentIds.flatMap(value => {
                const id = stringField(value, 'contentId');
                const info = kind.get(id);
                return info ? [{ id, kind: info.kind, payload: server.world.getContent(id as never) }] : [];
            });
            return jsonResponse({ cells, contents });
        }
        if (path === '/api/v1/snapshot' && request.method === 'POST') {
            if (auth?.method === 'client') return jsonResponse({ error: 'Management access required.' }, 403);
            if (request.headers.get('x-confirm-snapshot') !== 'replace') {
                return jsonResponse({ error: 'Snapshot replacement requires X-Confirm-Snapshot: replace.' }, 400);
            }
            const snapshot = await readJson(request, 25 * 1024 * 1024);
            createBackup(server, 'Before snapshot import');
            server.importSnapshot(snapshot);
            return jsonResponse({ imported: true, stats: server.world.stats() });
        }
        if (path === '/api/v1/plugins' && request.method === 'GET') return jsonResponse({ plugins: server.pluginNames() });
        if (path === '/api/v1/geometry' && request.method === 'POST') {
            const body = record(await readJson(request));
            const input = region(server.world, body.region);
            const geometry = server.world.geometry;
            const bounds = geometry.boundsOf(input);
            const cover = geometry.cover(input);
            let exact: readonly Address[] | null = null;
            try { exact = geometry.decompose(input, { maxBoxes: 256 }); }
            catch (error) { if (!(error instanceof RangeError)) throw error; }
            return jsonResponse({ bounds, cover, exact, bits: server.world.bits });
        }
        if (path === '/api/v1/cells' && request.method === 'GET') {
            const params = new URL(request.url).searchParams;
            const encoded = params.get('address');
            if (encoded === null) return jsonResponse(cellPage(server, params));
            const cell = server.world.getCell(address(server.world, JSON.parse(encoded)));
            return cell ? jsonResponse(cell) : jsonResponse({ error: 'Cell not found.' }, 404);
        }
        if (path === '/api/v1/cells/search' && request.method === 'POST') {
            const body = record(await readJson(request));
            if (body.overlap !== undefined && typeof body.overlap !== 'boolean') throw new TypeError('overlap must be a boolean.');
            return queryResponse(() => withLimit(server.world.searchCells(region(server.world, body.region), {
                overlap: body.overlap === true,
            }), limit(body.limit)));
        }
        if (path === '/api/v1/search' && request.method === 'POST') {
            const body = record(await readJson(request));
            if (body.unique !== undefined && typeof body.unique !== 'boolean') throw new TypeError('unique must be a boolean.');
            const options = queryOptions(body);
            return queryResponse(() => {
                const scope = region(server.world, body.region);
                const found = body.unique === true ? server.world.searchContent(scope, options) : server.world.search(scope, options);
                return withLimit(found, limit(body.limit));
            });
        }
        if (path === '/api/v1/nearest' && request.method === 'POST') {
            const body = record(await readJson(request));
            const maximum = limit(body.limit, 20);
            return queryResponse(() => withLimit(server.world.nearestContent(coordinates(body.at, 'at'), {
                ...queryOptions(body), limit: maximum,
            }), maximum));
        }
        if (path === '/api/v1/radius' && request.method === 'POST') {
            const body = record(await readJson(request));
            const at = coordinates(body.at, 'at');
            const radius = body.radius;
            if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0) throw new TypeError('radius must be a non-negative number.');
            return queryResponse(() => withLimit(server.world.radiusContent(at, radius, queryOptions(body)), limit(body.limit)));
        }
        if (path === '/api/v1/contents' && request.method === 'GET') {
            return jsonResponse(contentPage(server, new URL(request.url).searchParams));
        }
        if (path === '/api/v1/contents' && request.method === 'POST') {
            const body = record(await readJson(request));
            const kind = stringField(body.kind, 'kind');
            if (!Object.hasOwn(body, 'payload')) throw new TypeError('payload is required.');
            const metadata = body.metadata === undefined ? {} : record(body.metadata);
            if (metadata.kind !== undefined && metadata.kind !== kind) throw new TypeError('metadata.kind must match kind.');
            const attachmentMetadata = { ...metadata, kind };
            const id = server.transact(world => {
                return body.address === undefined
                    ? world.createContent(kind, body.payload)
                    : world.put(address(world, body.address), attachmentMetadata as never, body.payload);
            });
            return jsonResponse({ id }, 201);
        }
        if (path === '/api/v1/placements' && request.method === 'POST') {
            const body = record(await readJson(request));
            const id = stringField(body.id, 'id');
            const cellAddress = address(server.world, body.address);
            const content = server.db.query('SELECT kind FROM contents WHERE id = ?').get(id) as { kind: string } | null;
            if (!content) return jsonResponse({ error: 'Content not found.' }, 404);
            const metadata = body.metadata === undefined ? {} : record(body.metadata);
            if (metadata.kind !== undefined && metadata.kind !== content.kind) throw new TypeError('metadata.kind must match the content kind.');
            server.transact(world => world.attach(cellAddress, id as never, { ...metadata, kind: content.kind } as never));
            return jsonResponse({ id, address: cellAddress }, 201);
        }
        if (path === '/api/v1/placements' && request.method === 'PATCH') {
            const body = record(await readJson(request));
            const id = stringField(body.id, 'id');
            const cellAddress = address(server.world, body.address);
            const content = server.db.query('SELECT kind FROM contents WHERE id = ?').get(id) as { kind: string } | null;
            if (!content) return jsonResponse({ error: 'Content not found.' }, 404);
            const metadata = record(body.metadata);
            if (metadata.kind !== undefined && metadata.kind !== content.kind) throw new TypeError('metadata.kind must match the content kind.');
            server.transact(world => world.updateAttachment(cellAddress, id as never, { ...metadata, kind: content.kind } as never));
            return jsonResponse({ id, address: cellAddress, metadata: server.world.getCell(cellAddress)?.attachments.find(item => item.id === id)?.metadata });
        }
        if (path === '/api/v1/placements' && request.method === 'DELETE') {
            const body = record(await readJson(request));
            const id = stringField(body.id, 'id');
            const cellAddress = address(server.world, body.address);
            const removed = server.transact(world => world.detach(cellAddress, id as never));
            return jsonResponse({ removed });
        }
        if (path === '/api/v1/placements/relocate' && request.method === 'POST') {
            const body = record(await readJson(request));
            const id = stringField(body.id, 'id');
            const from = address(server.world, body.from);
            const to = address(server.world, body.to);
            const attachment = server.world.getCell(from)?.attachments.find(item => item.id === id);
            if (!attachment) return jsonResponse({ error: 'Source attachment does not exist.' }, 404);
            if (server.world.getCell(to)?.attachments.some(item => item.id === id)) {
                return jsonResponse({ error: 'This content is already attached at the destination.' }, 409);
            }
            server.transact(world => {
                world.detach(from, attachment.id);
                world.attach(to, attachment.id, attachment.metadata);
            });
            return jsonResponse({ id, address: to });
        }
        if (path === '/api/v1/placements/move' && request.method === 'POST') {
            const body = record(await readJson(request));
            const id = stringField(body.id, 'id');
            if (!Array.isArray(body.at) || body.at.length !== 3) throw new TypeError('at must be a three-coordinate vector.');
            const content = server.db.query('SELECT kind FROM contents WHERE id = ?').get(id) as { kind: string } | null;
            if (!content) return jsonResponse({ error: 'Content not found.' }, 404);
            const metadata = body.metadata === undefined ? undefined : record(body.metadata);
            if (metadata?.kind !== undefined && metadata.kind !== content.kind) throw new TypeError('metadata.kind must match the content kind.');
            server.transact(world => world.moveContent(id as never, body.at as Vec3, {
                ...(body.extent !== undefined ? { extent: body.extent as number | Vec3 } : {}),
                maxBoxes: 10000,
                ...(metadata ? { metadata: { ...metadata, kind: content.kind } as never } : {}),
            }));
            return jsonResponse({ id, placements: server.world.placements(id as never) });
        }
        if (path === '/api/v1/cells/metadata' && request.method === 'PATCH') {
            const body = record(await readJson(request));
            const cellAddress = address(server.world, body.address);
            server.transact(world => world.setCellMetadata(cellAddress, record(body.metadata)));
            return jsonResponse({ address: cellAddress, cell: server.world.getCell(cellAddress) });
        }
        if (path === '/api/v1/cells' && request.method === 'DELETE') {
            const body = record(await readJson(request));
            const cellAddress = address(server.world, body.address);
            return jsonResponse({ removed: server.transact(world => world.clearCell(cellAddress)) });
        }
        const contentMatch = /^\/api\/v1\/contents\/([^/]+)$/.exec(path);
        const placementsMatch = /^\/api\/v1\/contents\/([^/]+)\/placements$/.exec(path);
        if (placementsMatch && request.method === 'GET') {
            const id = decodeURIComponent(placementsMatch[1]!);
            if (!server.world.hasContent(id as never)) return jsonResponse({ error: 'Content not found.' }, 404);
            return jsonResponse({ id, placements: server.world.placements(id as never) });
        }
        if (contentMatch) {
            const id = decodeURIComponent(contentMatch[1]!);
            if (request.method === 'GET') {
                const row = server.db.query('SELECT kind FROM contents WHERE id = ?').get(id) as { kind: string } | null;
                if (!row) return jsonResponse({ error: 'Content not found.' }, 404);
                return jsonResponse({ id, kind: row.kind, payload: server.world.getContent(id as never), placements: server.world.placements(id as never) });
            }
            if (request.method === 'PATCH') {
                const body = record(await readJson(request));
                if (!Object.hasOwn(body, 'payload')) throw new TypeError('payload is required.');
                server.transact(world => world.setContent(id as never, body.payload));
                return jsonResponse({ id, payload: server.world.getContent(id as never) });
            }
            if (request.method === 'DELETE') {
                if (server.world.placements(id as never).length) {
                    return jsonResponse({ error: 'Detach all placements before removing this content.' }, 409);
                }
                return jsonResponse({ removed: server.transact(world => world.removeContent(id as never)) });
            }
        }
        if (path === '/api/v1/activity' && request.method === 'GET') {
            if (auth?.method === 'client') return jsonResponse({ error: 'Management access required.' }, 403);
            const params = new URL(request.url).searchParams;
            const pageLimit = params.has('limit') ? limit(Number(params.get('limit')), 256) : 256;
            const offset = params.has('offset') ? Math.max(0, Number(params.get('offset')) || 0) : 0;
            return jsonResponse(queryActivity({
                category: params.get('category') || undefined,
                name: params.get('name') || undefined,
                kind: params.get('kind') || undefined,
                contentId: params.get('contentId') || undefined,
                source: params.get('source') || undefined,
                limit: pageLimit,
                offset,
            }));
        }
        if (path === '/api/v1/queries') {
            if (auth?.method === 'client') return jsonResponse({ error: 'Management access required.' }, 403);
            if (request.method === 'GET') {
                const rows = server.db.query<{ id: string; name: string; config_json: string; updated_at: number }, []>(
                    'SELECT id, name, config_json, updated_at FROM saved_queries ORDER BY updated_at DESC',
                ).all();
                return jsonResponse({ queries: rows.map(row => ({ id: row.id, name: row.name, config: JSON.parse(row.config_json), updatedAt: row.updated_at })) });
            }
            if (request.method === 'POST') {
                const body = record(await readJson(request));
                const name = stringField(body.name, 'name', 100);
                const config = record(body.config);
                const now = Date.now();
                const id = crypto.randomUUID();
                server.db.query(`
                    INSERT INTO saved_queries (id, name, config_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(name) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at
                `).run(id, name, JSON.stringify(config), now, now);
                return jsonResponse({ saved: true, name });
            }
            if (request.method === 'DELETE') {
                const body = record(await readJson(request));
                const name = stringField(body.name, 'name', 100);
                const { changes } = server.db.query('DELETE FROM saved_queries WHERE name = ?').run(name);
                return jsonResponse({ removed: Boolean(changes) });
            }
        }
        if (path === '/api/v1/events' && request.method === 'POST') {
            const body = record(await readJson(request, 64 * 1024));
            const name = stringField(body.name, 'name', 100);
            if (!/^[A-Za-z][A-Za-z0-9:._-]*$/.test(name) || /^(mutation:|spatial:|update(?::|$))/.test(name)) {
                throw new TypeError('Choose a custom event name outside the reserved runtime namespaces.');
            }
            server.emit(name, body.data ?? null, body.region === undefined ? undefined : region(server.world, body.region));
            return jsonResponse({ emitted: true });
        }
        if (path === '/api/v1/events' && request.method === 'GET') return await eventStream(request, auth);
        return jsonResponse({ error: 'Route not found.' }, 404);
    } catch (error) {
        if (error instanceof MutationRejected) return jsonResponse({ error: 'The runtime rejected this mutation.' }, 409);
        const message = error instanceof Error ? error.message : 'Request failed.';
        const status = error instanceof RangeError || error instanceof TypeError || error instanceof SyntaxError ? 400 : 500;
        if (status === 500) {
            addActivity({ name: 'request:failed', category: 'diagnostic', regions: [], data: { method: request.method, errorType: error instanceof Error ? error.name : 'Unknown' } });
        }
        return jsonResponse({ error: status === 500 ? 'Internal server error.' : message }, status);
    }
}

async function eventStream(request: Request, auth?: AuthResult): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const server = await getRuntime();
    let scopedRegion: Region | undefined;
    const encodedRegion = params.get('region');
    if (encodedRegion) scopedRegion = region(server.world, JSON.parse(encodedRegion));
    const client = auth?.method === 'client' ? auth : undefined;
    const activity = params.get('activity') === '1';
    if (activity && client) return jsonResponse({ error: 'Management access required.' }, 403);
    if (client && !clientCredentialIsCurrent(client.principal.clientId, client.revision)) {
        return jsonResponse({ error: 'Authentication required.' }, 401);
    }
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            let dispose = () => {};
            let disposeActivity = () => {};
            let untrack: (() => void) | undefined;
            let heartbeat: ReturnType<typeof setInterval> | undefined;
            let closed = false;
            cleanup = () => {
                if (closed) return;
                closed = true;
                dispose();
                disposeActivity();
                untrack?.();
                clearInterval(heartbeat);
                request.signal.removeEventListener('abort', close);
            };
            const close = () => {
                if (closed) return;
                cleanup();
                controller.close();
            };
            const revoke = () => {
                if (closed) return;
                cleanup();
                controller.close();
            };
            const send = (message: string) => {
                if (closed) return;
                if ((controller.desiredSize ?? 0) <= 0) {
                    cleanup();
                    controller.error(new Error('Event stream buffer exceeded.'));
                    return;
                }
                controller.enqueue(encoder.encode(message));
            };
            if (request.signal.aborted) return close();
            if (client) {
                untrack = registerClientStream(client.principal.clientId, client.revision, revoke);
                if (!untrack) return revoke();
            } else if (auth?.method === 'session') {
                untrack = registerSessionStream(auth, revoke);
                if (!untrack) return revoke();
            }
            try {
                dispose = server.subscribe(event => {
                    const change = event.regions.length + event.contentIds.length > 256
                        ? { regions: [], contentIds: [], reset: true } : event;
                    send(`event: change\ndata: ${JSON.stringify(change)}\n\n`);
                }, scopedRegion);
                if (activity) {
                    disposeActivity = subscribeActivity(event => send(`event: activity\ndata: ${JSON.stringify(event)}\n\n`));
                }
                request.signal.addEventListener('abort', close, { once: true });
                send('event: ready\ndata: {}\n\n');
                heartbeat = setInterval(() => send(': keep-alive\n\n'), 15000);
            } catch (error) {
                cleanup();
                throw error;
            }
        },
        cancel() { cleanup(); },
    }, { highWaterMark: 64 });
    return new Response(stream, { headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
    } });
}
