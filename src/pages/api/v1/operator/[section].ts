import type { APIRoute } from 'astro';
import { backup, createBackup, deleteBackup, diagnostics, settings, storageInfo, validateStorage } from '../../../../lib/operations';
import { jsonResponse, readJson, record, stringField } from '../../../../lib/http';
import { getRuntime } from '../../../../lib/runtime';
import { addActivity, queryActivity, setActivityRetention } from '../../../../lib/activity/journal';
import { revokeAllSessions } from '../../../../lib/auth';
import { overviewStats } from '../../../../lib/overview/server';
import { getLuaBindingDocs } from '../../../../lib/lua-bindings';

const forbidden = () => jsonResponse({ error: 'Management access required.' }, 403);
const missing = () => jsonResponse({ error: 'Operation not found.' }, 404);

export const GET: APIRoute = async ({ locals, params, url }) => {
    if (!locals.auth || locals.auth.method === 'client') return forbidden();
    const server = await getRuntime();
    switch (params.section) {
        case 'plugins': {
            const logSource = url.searchParams.get('logs');
            if (logSource) {
                return jsonResponse(queryActivity({ category: 'diagnostic', source: logSource, limit: 100 }));
            }
            return jsonResponse({ plugins: server.pluginStatus(), scheduler: server.schedulerStatus() });
        }
        case 'lua': {
            if (url.searchParams.get('docs') === '1') {
                return jsonResponse({ docs: getLuaBindingDocs() });
            }
            const pluginId = url.searchParams.get('plugin');
            if (pluginId) {
                const plugin = server.luaHost.getPlugin(pluginId);
                return plugin ? jsonResponse({ plugin }) : missing();
            }
            return jsonResponse({
                plugins: server.luaHost.listPlugins(),
                sharedModules: server.luaHost.listSharedModules(),
                docs: getLuaBindingDocs(),
            });
        }
        case 'diagnostics': return jsonResponse(diagnostics(server));
        case 'settings': return jsonResponse(settings(server));
        case 'storage': return jsonResponse({
            ...storageInfo(server), databasePath: settings(server).startup.databasePath, ...overviewStats(server).storage,
        });
        case 'backup': {
            const id = url.searchParams.get('id');
            const snapshot = id ? backup(server, id) : undefined;
            return snapshot ? jsonResponse(snapshot) : missing();
        }
        default: return missing();
    }
};

export const POST: APIRoute = async ({ locals, params, request }) => {
    if (!locals.auth || locals.auth.method === 'client') return forbidden();
    try {
        const server = await getRuntime();
        const body = record(await readJson(request, 4096));
        switch (params.section) {
            case 'plugins':
                if (typeof body.enabled !== 'boolean') throw new TypeError('enabled must be a boolean.');
                return (await server.togglePlugin(stringField(body.filename, 'filename'), body.enabled))
                    ? jsonResponse({ plugins: server.pluginStatus(), scheduler: server.schedulerStatus() })
                    : missing();
            case 'lua':
                if (body.operation === 'create-plugin' || body.operation === 'save-plugin') {
                    const plugin = await server.luaHost.savePlugin({
                        id: stringField(body.id, 'id', 64),
                        name: stringField(body.name, 'name', 80),
                        description: typeof body.description === 'string' ? body.description : '',
                        version: typeof body.version === 'string' ? body.version : '1.0.0',
                        entrypoint: typeof body.entrypoint === 'string' ? body.entrypoint : 'main.lua',
                        config: body.config && typeof body.config === 'object' && !Array.isArray(body.config)
                            ? body.config as Record<string, unknown>
                            : undefined,
                        files: Array.isArray(body.files) ? body.files as { path: string; content: string }[] : [],
                        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
                        createOnly: body.operation === 'create-plugin',
                    });
                    return jsonResponse({ plugin, plugins: server.pluginStatus() });
                }
                if (body.operation === 'reload-plugin') {
                    const plugin = await server.luaHost.reloadPlugin(stringField(body.id, 'id', 64));
                    return plugin ? jsonResponse({ plugin, plugins: server.pluginStatus() }) : missing();
                }
                if (body.operation === 'delete-plugin') {
                    const deleted = await server.luaHost.deletePlugin(stringField(body.id, 'id', 64));
                    return deleted ? jsonResponse({ deleted: true, plugins: server.pluginStatus() }) : missing();
                }
                if (body.operation === 'save-module') {
                    const mod = await server.luaHost.saveSharedModule(
                        stringField(body.name, 'name', 64),
                        typeof body.description === 'string' ? body.description : '',
                        typeof body.content === 'string' ? body.content : '',
                    );
                    return jsonResponse({ module: mod });
                }
                if (body.operation === 'delete-module') {
                    const deleted = await server.luaHost.deleteSharedModule(stringField(body.name, 'name', 64));
                    return deleted ? jsonResponse({ deleted: true }) : missing();
                }
                return jsonResponse({ error: 'Unknown lua operation.' }, 400);
            case 'scheduler': {
                const interval = body.intervalMs;
                if (typeof interval !== 'number' || !Number.isInteger(interval) || (interval !== 0 && (interval < 50 || interval > 60000))) {
                    throw new TypeError('Use 0 to stop the scheduler, or an interval from 50 to 60000 ms.');
                }
                server.setUpdateInterval(interval);
                return jsonResponse(server.schedulerStatus());
            }
            case 'settings':
                if (body.operation === 'revoke-sessions' && body.confirm === 'revoke-sessions') {
                    return jsonResponse({ revoked: revokeAllSessions() });
                }
                if (body.operation === 'set-retention') {
                    const limit = setActivityRetention(Number(body.limit));
                    return jsonResponse({ limit });
                }
                return jsonResponse({ error: 'Operation and confirmation are required.' }, 400);
            case 'storage': {
                if (body.operation === 'validate') return jsonResponse(validateStorage(server));
                if (body.operation === 'backup') return jsonResponse(createBackup(server, stringField(body.label, 'label', 120)), 201);
                if (body.operation === 'delete-backup') {
                    return deleteBackup(server, stringField(body.id, 'id')) ? jsonResponse({ deleted: true }) : missing();
                }
                if (body.operation === 'restore' && body.confirm === 'restore') {
                    const snapshot = backup(server, stringField(body.id, 'id'));
                    if (!snapshot) return missing();
                    createBackup(server, 'Before restore');
                    server.importSnapshot(snapshot);
                    return jsonResponse({ restored: true });
                }
                if (body.operation === 'collect-orphans' && body.confirm === 'collect-orphans') {
                    const removed = server.transact(world => world.collectOrphans());
                    return jsonResponse({ count: removed.length });
                }
                return jsonResponse({ error: 'Operation and confirmation are required.' }, 400);
            }
            default: return missing();
        }
    } catch (error) {
        if (error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError) {
            return jsonResponse({ error: error.message }, 400);
        }
        addActivity({ name: 'operator:error', category: 'diagnostic', regions: [], data: { section: params.section } });
        return jsonResponse({ error: 'Operation failed.' }, 500);
    }
};
