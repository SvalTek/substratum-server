import type LuaBridge from 'webluabridge';
import { createLuaBridge, type LuaExecutionContext } from 'webluabridge';
import { addActivity } from './activity/journal';
import { runInLuaPluginScope, setLuaBindingsRuntime, setLuaDisposerRegistrar, substratumLuaBindings } from './lua-bindings';
import { principalContext } from './principal';
import type { RuntimeService } from './runtime';

export interface LuaPluginFile {
    path: string;
    content: string;
    updatedAt: number;
}

export interface LuaPluginEntity {
    id: string;
    name: string;
    description: string;
    version: string;
    entrypoint: string;
    config: Record<string, unknown>;
    enabled: boolean;
    createdAt: number;
    updatedAt: number;
    files: LuaPluginFile[];
}

export interface LuaSharedModule {
    name: string;
    description: string;
    content: string;
    updatedAt: number;
}

interface PluginRow {
    id: string;
    name: string;
    description: string;
    version: string;
    entrypoint: string;
    config_json: string;
    enabled: number;
    created_at: number;
    updated_at: number;
}

interface FileRow {
    plugin_id: string;
    path: string;
    content: string;
    updated_at: number;
}

interface SharedRow {
    name: string;
    description: string;
    content: string;
    updated_at: number;
}

interface ActiveLuaPlugin {
    id: string;
    name: string;
    env: Record<string, unknown>;
    context: LuaExecutionContext<Record<string, unknown>>;
    disposers: (() => void)[];
}

const VALID_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const VALID_FILE_PATH = /^(?!.*\.\.)[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const VALID_MODULE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

export function validatePluginId(raw: unknown): string {
    if (typeof raw !== 'string') throw new TypeError('Plugin ID must be a string.');
    const id = raw.trim().toLowerCase();
    if (!VALID_ID.test(id)) {
        throw new TypeError('Plugin ID must be 1–64 lowercase letters, digits, hyphens, or underscores.');
    }
    return id;
}

export function validatePluginFilePath(raw: unknown): string {
    if (typeof raw !== 'string') throw new TypeError('File path must be a string.');
    const path = raw.trim().replace(/^\/+/, '');
    if (!path || path.length > 128 || !VALID_FILE_PATH.test(path)) {
        throw new TypeError('File path must be 1–128 safe characters without "..".');
    }
    return path;
}

export function validateModuleName(raw: unknown): string {
    if (typeof raw !== 'string') throw new TypeError('Module name must be a string.');
    const name = raw.trim().replace(/\.lua$/i, '');
    if (!VALID_MODULE_NAME.test(name)) {
        throw new TypeError('Module name must be 1–64 identifier characters (letters, digits, _, ., -).');
    }
    return name;
}

export class LuaPluginHost {
    private bridge: LuaBridge | null = null;
    private readonly active = new Map<string, ActiveLuaPlugin>();
    private readonly errors = new Map<string, string>();
    private readonly pluginLocks = new Map<string, Promise<void>>();
    private activePrintPlugin: string | null = null;

    constructor(private readonly server: RuntimeService) {}

    private async withPluginLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
        const previous = this.pluginLocks.get(id) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const chained = previous.then(() => gate);
        this.pluginLocks.set(id, chained);
        await previous;
        try {
            return await fn();
        } finally {
            release();
            if (this.pluginLocks.get(id) === chained) {
                this.pluginLocks.delete(id);
            }
        }
    }

    async initialize(): Promise<void> {
        setLuaBindingsRuntime(this.server);
        setLuaDisposerRegistrar((pluginId, dispose) => {
            this.active.get(pluginId)?.disposers.push(dispose);
        });
        this.bridge = await createLuaBridge({}, {
            bindings: substratumLuaBindings,
            functionTimeout: 2000,
            traceAllocations: true,
        });
        this.bridge.setMemoryMax(32 * 1024 * 1024);
        this.bridge.onPrint((message: string) => {
            const source = this.activePrintPlugin ?? 'lua';
            addActivity({
                name: 'plugin:log',
                category: 'diagnostic',
                source,
                level: 'info',
                regions: [],
                data: { name: source, level: 'info', message: String(message).slice(0, 1000) },
            });
        });
        await this.mountAllVfs();
        for (const plugin of this.listPlugins()) {
            if (plugin.enabled) {
                await this.loadPlugin(plugin);
            }
        }
    }

    listPlugins(): LuaPluginEntity[] {
        const plugins = this.server.db.query<PluginRow, []>(
            'SELECT id, name, description, version, entrypoint, config_json, enabled, created_at, updated_at FROM lua_plugins ORDER BY name ASC',
        ).all();
        const files = this.server.db.query<FileRow, []>(
            'SELECT plugin_id, path, content, updated_at FROM lua_plugin_files ORDER BY path ASC',
        ).all();
        const byPlugin = new Map<string, LuaPluginFile[]>();
        for (const f of files) {
            const list = byPlugin.get(f.plugin_id) ?? [];
            list.push({ path: f.path, content: f.content, updatedAt: f.updated_at });
            byPlugin.set(f.plugin_id, list);
        }
        return plugins.map(row => ({
            id: row.id,
            name: row.name,
            description: row.description,
            version: row.version,
            entrypoint: row.entrypoint,
            config: JSON.parse(row.config_json),
            enabled: Boolean(row.enabled),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            files: byPlugin.get(row.id) ?? [],
        }));
    }

    getPlugin(rawId: string): LuaPluginEntity | undefined {
        const id = validatePluginId(rawId);
        const row = this.server.db.query<PluginRow, [string]>(
            'SELECT id, name, description, version, entrypoint, config_json, enabled, created_at, updated_at FROM lua_plugins WHERE id = ?',
        ).get(id);
        if (!row) return undefined;
        const files = this.server.db.query<FileRow, [string]>(
            'SELECT plugin_id, path, content, updated_at FROM lua_plugin_files WHERE plugin_id = ? ORDER BY path ASC',
        ).all(id);
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            version: row.version,
            entrypoint: row.entrypoint,
            config: JSON.parse(row.config_json),
            enabled: Boolean(row.enabled),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            files: files.map(f => ({ path: f.path, content: f.content, updatedAt: f.updated_at })),
        };
    }

    getPluginConfig(id: string): Record<string, unknown> {
        const row = this.server.db.query<{ config_json: string }, [string]>(
            'SELECT config_json FROM lua_plugins WHERE id = ?',
        ).get(id);
        return row ? JSON.parse(row.config_json) : {};
    }

    setPluginConfigKey(id: string, key: string, value: unknown): void {
        const cfg = this.getPluginConfig(id);
        cfg[key] = value;
        this.server.db.query('UPDATE lua_plugins SET config_json = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(cfg), Date.now(), id);
    }

    async savePlugin(input: {
        id: string;
        name: string;
        description?: string;
        version?: string;
        entrypoint?: string;
        config?: Record<string, unknown>;
        files: { path: string; content: string }[];
        enabled?: boolean;
        createOnly?: boolean;
    }): Promise<LuaPluginEntity> {
        const id = validatePluginId(input.id);
        const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 80) : id;
        const description = typeof input.description === 'string' ? input.description.trim().slice(0, 500) : '';
        const version = typeof input.version === 'string' && input.version.trim() ? input.version.trim().slice(0, 32) : '1.0.0';
        const entrypoint = validatePluginFilePath(input.entrypoint ?? 'main.lua');
        const existing = this.getPlugin(id);
        if (input.createOnly && existing) {
            throw new TypeError(`A Lua plugin with ID "${id}" already exists.`);
        }
        const config = input.config ?? existing?.config ?? {};
        const enabled = input.enabled ?? existing?.enabled ?? true;
        if (!Array.isArray(input.files) || !input.files.length) {
            throw new TypeError('A plugin must contain at least one source file.');
        }
        const normalizedFiles = input.files.map(f => {
            const path = validatePluginFilePath(f.path);
            if (typeof f.content !== 'string' || f.content.length > 256 * 1024) {
                throw new TypeError(`File "${path}" content must be a string under 256 KiB.`);
            }
            return { path, content: f.content };
        });
        if (!normalizedFiles.some(f => f.path === entrypoint)) {
            throw new TypeError(`Entrypoint "${entrypoint}" must exist in plugin files.`);
        }

        const now = Date.now();
        this.server.db.transaction(() => {
            this.server.db.query(`
                INSERT INTO lua_plugins (id, name, description, version, entrypoint, config_json, enabled, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description,
                    version = excluded.version,
                    entrypoint = excluded.entrypoint,
                    config_json = excluded.config_json,
                    enabled = excluded.enabled,
                    updated_at = excluded.updated_at
            `).run(id, name, description, version, entrypoint, JSON.stringify(config), enabled ? 1 : 0, existing?.createdAt ?? now, now);

            this.server.db.query('DELETE FROM lua_plugin_files WHERE plugin_id = ?').run(id);
            const insertFile = this.server.db.query('INSERT INTO lua_plugin_files (plugin_id, path, content, updated_at) VALUES (?, ?, ?, ?)');
            for (const f of normalizedFiles) {
                insertFile.run(id, f.path, f.content, now);
            }
        })();

        const saved = this.getPlugin(id)!;
        await this.mountPluginFiles(saved);
        await this.unloadPlugin(id);
        if (saved.enabled) {
            await this.loadPlugin(saved);
        }
        return saved;
    }

    async reloadPlugin(rawId: string): Promise<LuaPluginEntity | undefined> {
        const plugin = this.getPlugin(rawId);
        if (!plugin) return undefined;
        await this.mountPluginFiles(plugin);
        await this.unloadPlugin(plugin.id);
        if (plugin.enabled) {
            await this.loadPlugin(plugin);
        }
        return plugin;
    }

    async deletePlugin(rawId: string): Promise<boolean> {
        const id = validatePluginId(rawId);
        await this.unloadPlugin(id);
        this.errors.delete(id);
        const { changes } = this.server.db.query('DELETE FROM lua_plugins WHERE id = ?').run(id);
        return Boolean(changes);
    }

    async togglePlugin(rawId: string, enabled: boolean): Promise<boolean> {
        const plugin = this.getPlugin(rawId);
        if (!plugin) return false;
        this.server.db.query('UPDATE lua_plugins SET enabled = ?, updated_at = ? WHERE id = ?')
            .run(enabled ? 1 : 0, Date.now(), plugin.id);
        if (enabled) {
            await this.loadPlugin({ ...plugin, enabled: true });
        } else {
            await this.unloadPlugin(plugin.id);
            this.errors.delete(plugin.id);
        }
        return true;
    }

    listSharedModules(): LuaSharedModule[] {
        return this.server.db.query<SharedRow, []>(
            'SELECT name, description, content, updated_at FROM lua_shared_modules ORDER BY name ASC',
        ).all().map(row => ({
            name: row.name,
            description: row.description,
            content: row.content,
            updatedAt: row.updated_at,
        }));
    }

    async saveSharedModule(rawName: string, description: string, content: string): Promise<LuaSharedModule> {
        const name = validateModuleName(rawName);
        if (typeof content !== 'string' || content.length > 256 * 1024) {
            throw new TypeError('Module content must be a string under 256 KiB.');
        }
        const now = Date.now();
        this.server.db.query(`
            INSERT INTO lua_shared_modules (name, description, content, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                description = excluded.description,
                content = excluded.content,
                updated_at = excluded.updated_at
        `).run(name, description.trim().slice(0, 500), content, now);
        if (this.bridge) {
            await this.bridge.mountFile(`shared/${name.replaceAll('.', '/')}.lua`, content);
            await this.reloadAllEnabled();
        }
        return { name, description: description.trim().slice(0, 500), content, updatedAt: now };
    }

    async deleteSharedModule(rawName: string): Promise<boolean> {
        const name = validateModuleName(rawName);
        const { changes } = this.server.db.query('DELETE FROM lua_shared_modules WHERE name = ?').run(name);
        if (changes && this.bridge) await this.reloadAllEnabled();
        return Boolean(changes);
    }

    pluginStatus() {
        return this.listPlugins().map(plugin => {
            const active = this.active.get(plugin.id);
            const error = this.errors.get(plugin.id);
            return {
                id: plugin.id,
                name: plugin.name,
                description: plugin.description,
                version: plugin.version,
                filename: plugin.entrypoint,
                entrypoint: plugin.entrypoint,
                fileCount: plugin.files.length,
                config: plugin.config,
                enabled: plugin.enabled,
                source: 'lua' as const,
                status: error ? 'error' : active ? 'active' : 'disabled',
                error,
            };
        });
    }

    pluginNames(): string[] {
        return [...this.active.values()].map(item => item.id);
    }

    private async mountPluginFiles(plugin: LuaPluginEntity): Promise<void> {
        if (!this.bridge) return;
        for (const file of plugin.files) {
            await this.bridge.mountFile(`plugins/${plugin.id}/${file.path}`, file.content);
        }
    }

    private async mountAllVfs(): Promise<void> {
        if (!this.bridge) return;
        for (const mod of this.listSharedModules()) {
            await this.bridge.mountFile(`shared/${mod.name.replaceAll('.', '/')}.lua`, mod.content);
        }
        for (const plugin of this.listPlugins()) {
            await this.mountPluginFiles(plugin);
        }
    }

    private async reloadAllEnabled(): Promise<void> {
        const plugins = this.listPlugins().filter(plugin => plugin.enabled);
        for (const plugin of plugins) await this.unloadPlugin(plugin.id);
        for (const plugin of plugins) await this.loadPlugin(plugin);
    }

    private unloadPlugin(id: string): Promise<void> {
        return this.withPluginLock(id, async () => {
            const active = this.active.get(id);
            if (!active) return;
            this.active.delete(id);
            for (const dispose of active.disposers) {
                try { dispose(); } catch { /* Best-effort cleanup */ }
            }
            try {
                await this.runScoped(id, () => active.context.execute(`
                    local reg = rawget(_G, "__substratum_plugins")
                    local exports = reg and reg[PLUGIN_ID]
                    if type(exports) == "table" and type(exports.shutdown) == "function" then
                        exports.shutdown()
                    elseif type(OnShutdown) == "function" then
                        OnShutdown()
                    end
                    if reg then reg[PLUGIN_ID] = nil end
                `));
            } catch (error) {
                this.recordError(id, 'cleanup', error);
            }
        });
    }

    private loadPlugin(plugin: LuaPluginEntity): Promise<void> {
        return this.withPluginLock(plugin.id, async () => {
            if (!this.bridge) return;
            this.errors.delete(plugin.id);
            const entryFile = plugin.files.find(f => f.path === plugin.entrypoint);
            if (!entryFile) {
                this.recordError(plugin.id, 'install', `Entrypoint "${plugin.entrypoint}" not found.`);
                return;
            }
            const env: Record<string, unknown> = {
                PLUGIN_ID: plugin.id,
                PLUGIN_NAME: plugin.name,
                PLUGIN_VERSION: plugin.version,
            };
            const disposers: (() => void)[] = [];
            let activeEntry: ActiveLuaPlugin | undefined;
            try {
                const context = await this.bridge.useEnvironment(env);
                activeEntry = { id: plugin.id, name: plugin.name, env, context, disposers };
                this.active.set(plugin.id, activeEntry);
                await this.runScoped(plugin.id, async () => {
                    // Install plugin-scoped require() that resolves plugin-owned modules first, then shared modules.
                    await context.execute(`
                        local __base_require = require
                        local __plugin_prefix = "plugins." .. PLUGIN_ID .. "."
                        local __mod_cache = {}
                        local function __resolve_vfs(name)
                            local rel = string.gsub(name, "%.", "/")
                            if not string.match(rel, "%.lua$") then rel = rel .. ".lua" end
                            local plugin_path = "plugins/" .. PLUGIN_ID .. "/" .. rel
                            local f = io.open(plugin_path, "r")
                            if f then
                                local src = f:read("*a")
                                f:close()
                                return src, plugin_path
                            end
                            local shared_path = "shared/" .. rel
                            local sf = io.open(shared_path, "r")
                            if sf then
                                local src = sf:read("*a")
                                sf:close()
                                return src, shared_path
                            end
                            return nil, nil
                        end
                        require = function(name)
                            if __mod_cache[name] ~= nil then return __mod_cache[name] end
                            local src, chunkname = __resolve_vfs(name)
                            if src then
                                local fn, err = load(src, "@" .. chunkname, "t", _ENV)
                                if not fn then error(err, 2) end
                                local res = fn(name)
                                if res == nil then res = true end
                                __mod_cache[name] = res
                                return res
                            end
                            return __base_require(name)
                        end
                    `);
                    await context.execute(`
                        local reg = rawget(_G, "__substratum_plugins")
                        if not reg then
                            reg = {}
                            rawset(_G, "__substratum_plugins", reg)
                        end
                        local __fn, __err = load(..., "@" .. ${JSON.stringify(`plugins/${plugin.id}/${plugin.entrypoint}`)}, "t", _ENV)
                        if not __fn then error(__err, 2) end
                        local exports = __fn()
                        reg[PLUGIN_ID] = exports
                        if type(exports) == "table" and type(exports.init) == "function" then
                            exports.init(plugin)
                        elseif type(OnInit) == "function" then
                            OnInit(plugin)
                        end
                    `, entryFile.content);
                });

                if (this.active.get(plugin.id) !== activeEntry) return;

                const stopSpatial = this.server.world.on('spatial:change', event => {
                    void this.runScoped(plugin.id, () => context.execute(`
                        local ev = ...
                        local reg = rawget(_G, "__substratum_plugins")
                        local exports = reg and reg[PLUGIN_ID]
                        if type(exports) == "table" and type(exports.onSpatialChange) == "function" then
                            exports.onSpatialChange(ev)
                        elseif type(OnSpatialChange) == "function" then
                            OnSpatialChange(ev)
                        end
                    `, { regions: event.regions, changes: event.changes, transitions: event.transitions })).catch(error => this.recordError(plugin.id, 'spatial:change', error));
                });
                disposers.push(stopSpatial);

                const stopUpdate = this.server.world.on('update', dt => {
                    void this.runScoped(plugin.id, () => context.execute(`
                        local dt = ...
                        local reg = rawget(_G, "__substratum_plugins")
                        local exports = reg and reg[PLUGIN_ID]
                        if type(exports) == "table" and type(exports.update) == "function" then
                            exports.update(dt)
                        elseif type(Update) == "function" then
                            Update(dt)
                        end
                    `, dt)).catch(error => this.recordError(plugin.id, 'update', error));
                });
                disposers.push(stopUpdate);
            } catch (error) {
                if (activeEntry && this.active.get(plugin.id) === activeEntry) {
                    this.active.delete(plugin.id);
                }
                for (const dispose of disposers) {
                    try { dispose(); } catch { /* Best-effort cleanup */ }
                }
                this.recordError(plugin.id, 'install', error);
            }
        });
    }

    private async runScoped<T>(id: string, fn: () => Promise<T>): Promise<T> {
        const previous = this.activePrintPlugin;
        this.activePrintPlugin = id;
        try {
            return await principalContext.run({ type: 'system', source: `lua:${id}` }, () =>
                runInLuaPluginScope(id, fn),
            );
        } finally {
            this.activePrintPlugin = previous;
        }
    }

    private recordError(id: string, phase: string, cause: unknown): void {
        const message = cause instanceof Error ? cause.message : String(cause);
        this.errors.set(id, message);
        addActivity({
            name: `plugin:${phase}-failed`,
            category: 'diagnostic',
            source: id,
            level: 'error',
            regions: [],
            data: { id, source: 'lua', phase, error: message },
        });
    }

    async dispose(): Promise<void> {
        for (const id of [...this.active.keys()]) {
            await this.unloadPlugin(id);
        }
        this.bridge?.onPrint(null);
        this.bridge?.close();
        this.bridge = null;
        setLuaDisposerRegistrar(null);
        setLuaBindingsRuntime(null);
    }
}
