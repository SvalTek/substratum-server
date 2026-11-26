import { mkdirSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Database } from 'bun:sqlite';
import { MutationRejected, Substratum } from '@svaltek/substratum';
import type { Address, Mutation, Region } from '@svaltek/substratum';
import { getConfig } from './config';
import { getDatabase } from './database';
import type { RuntimeChange, Snapshot } from './atlas/types';
import { currentPrincipal, principalContext } from './principal';
import type { Principal } from './principal';
import { recordMutation } from './metrics';
import { addActivity } from './activity/journal';
import { LuaPluginHost } from './lua-host';

type CustomEvents = Record<string, unknown>;
export type ServerWorld = Substratum<Record<string, unknown>, Record<string, unknown>, CustomEvents>;
type ServerMutation = Mutation<Record<string, unknown>, Record<string, unknown>>;
type ChangeListener = (event: RuntimeChange) => void;
export interface ServerPluginContext {
    readonly name: string;
    readonly principal: Principal;
    transact<T>(run: (world: ServerWorld) => T): T;
    emit(name: string, data: unknown, region?: Region): void;
    log(level: 'info' | 'warn' | 'error', message: string): void;
}
type PluginInstaller = (world: ServerWorld, context: ServerPluginContext) => void | (() => void);
interface DiscoveredPlugin {
    readonly name: string;
    readonly filename: string;
    install?: PluginInstaller;
    dispose?: () => void;
    enabled: boolean;
    error?: string;
    blocked?: boolean;
}

function json(value: unknown, label: string): string {
    let encoded: string | undefined;
    try { encoded = JSON.stringify(value); }
    catch { throw new TypeError(`${label} must be JSON-serializable.`); }
    if (encoded === undefined) throw new TypeError(`${label} must be JSON-serializable.`);
    return encoded;
}

function addressKey(address: Address): string { return `${address[0]}/${address[1]}/${address[2]}`; }

export class RuntimeService {
    readonly db: Database;
    world: ServerWorld;
    private readonly writeQueries: {
        contentUpsert: ReturnType<Database['query']>;
        contentDelete: ReturnType<Database['query']>;
        cellUpsert: ReturnType<Database['query']>;
        cellDelete: ReturnType<Database['query']>;
        attachmentUpsert: ReturnType<Database['query']>;
        attachmentDelete: ReturnType<Database['query']>;
    };
    private readonly persistDisposers: (() => void)[] = [];
    private readonly listeners = new Set<{ region?: Region; listener: ChangeListener; dispose: () => void }>();
    private readonly plugins: DiscoveredPlugin[] = [];
    readonly luaHost: LuaPluginHost;
    private updateTimer: ReturnType<typeof setInterval> | undefined;
    private updateInterval = 0;
    private afterCommit: (() => void)[] | undefined;
    private readonly writeTransaction: <T>(run: () => T) => T;

    constructor() {
        this.db = getDatabase();
        const savedBits = this.db.query("SELECT value FROM settings WHERE key = 'bits'").get() as { value: string } | null;
        const bits = savedBits ? Number(savedBits.value) : getConfig().bits;
        if (!savedBits) this.db.query("INSERT INTO settings(key, value) VALUES ('bits', ?)").run(String(bits));
        // Once stored, the address resolution belongs to the persisted world.
        this.writeQueries = {
            contentUpsert: this.db.query('INSERT INTO contents(id, kind, payload_json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, payload_json=excluded.payload_json'),
            contentDelete: this.db.query('DELETE FROM contents WHERE id = ?'),
            cellUpsert: this.db.query('INSERT INTO cells(address_key, address_json, metadata_json) VALUES (?, ?, ?) ON CONFLICT(address_key) DO UPDATE SET address_json=excluded.address_json, metadata_json=excluded.metadata_json'),
            cellDelete: this.db.query('DELETE FROM cells WHERE address_key = ?'),
            attachmentUpsert: this.db.query('INSERT INTO attachments(address_key, content_id, metadata_json) VALUES (?, ?, ?) ON CONFLICT(address_key, content_id) DO UPDATE SET metadata_json=excluded.metadata_json'),
            attachmentDelete: this.db.query('DELETE FROM attachments WHERE address_key = ? AND content_id = ?'),
        };
        this.world = this.restore(bits);
        this.luaHost = new LuaPluginHost(this);
        this.writeTransaction = <T>(run: () => T): T => {
            const transaction = this.db.transaction(run);
            const pending: (() => void)[] = [];
            this.afterCommit = pending;
            let result: T;
            try { result = transaction() as T; }
            finally { this.afterCommit = undefined; }
            for (const notify of pending) notify();
            return result;
        };
        this.installPersistence();
    }

    async initialize(): Promise<this> {
        const directory = getConfig().pluginsDirectory;
        mkdirSync(directory, { recursive: true });
        const entries = await readdir(directory, { withFileTypes: true });
        const files = entries
            .filter(entry => entry.isFile() && /\.(?:ts|mts|js|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts'))
            .map(entry => entry.name)
            .sort((a, b) => a.localeCompare(b));
        for (const filename of files) {
            const name = filename.replace(/\.(?:ts|mts|js|mjs)$/, '');
            const saved = this.db.query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?').get(`plugin:${filename}`);
            const plugin: DiscoveredPlugin = { name, filename, enabled: saved?.value !== 'disabled' };
            this.plugins.push(plugin);
            try {
                const module = await import(
                    /* @vite-ignore */
                    pathToFileURL(join(directory, filename)).href
                ) as { default?: unknown; install?: unknown };
                const install = typeof module.default === 'function' ? module.default : module.install;
                if (typeof install !== 'function') throw new TypeError('Export a default installer or a named install function.');
                plugin.install = install as PluginInstaller;
            } catch (error) { this.reportPluginError(plugin, 'load', error); }
        }
        this.installPlugins();
        await this.luaHost.initialize();
        const savedInterval = this.db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'plugin_update_interval'").get();
        this.scheduleUpdates(Number(savedInterval?.value ?? 0));
        return this;
    }

    private reportPluginError(plugin: DiscoveredPlugin, phase: string, cause: unknown) {
        const message = cause instanceof Error ? cause.message : 'Unknown error';
        plugin.error = this.safeLogMessage(message);
        addActivity({ name: `plugin:${phase}-failed`, category: 'diagnostic', source: plugin.name, level: 'error', regions: [], data: { name: plugin.name, error: plugin.error } });
    }

    private safeLogMessage(message: string) {
        const config = getConfig();
        return message.replaceAll(config.managementToken, '[redacted]').replaceAll(config.dashboardPassword, '[redacted]')
            .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]').replace(/(?<![\w-])[A-Za-z0-9_-]{43}(?![\w-])/g, '[redacted]').slice(0, 500);
    }

    private installPlugin(plugin: DiscoveredPlugin): void {
        if (!plugin.enabled || !plugin.install || plugin.dispose || plugin.blocked) return;
        const install = plugin.install;
        let dispose: (() => void) | undefined;
        try {
            principalContext.run({ type: 'system', source: 'plugin-install' }, () => {
                this.writeTransaction(() => this.world.batch(() => {
                    dispose = this.world.use(world => install(world, {
                        name: plugin.name,
                        get principal() { return currentPrincipal(); },
                        transact: run => this.transact(run),
                        emit: (name, data, region) => this.emit(name, data, region),
                        log: (level, message) => addActivity({
                            name: 'plugin:log', category: 'diagnostic', source: plugin.name, level, regions: [],
                            data: { name: plugin.name, level, message: this.safeLogMessage(String(message)) },
                        }),
                    }));
                }));
            });
            plugin.dispose = dispose;
            plugin.error = undefined;
        } catch (error) {
            plugin.blocked = true;
            if (dispose) {
                try { dispose(); } catch { /* report the installation failure */ }
                this.disposePlugins();
                this.restorePersistedWorld();
                this.installPlugins();
            }
            this.reportPluginError(plugin, 'install', error);
        }
    }

    private installPlugins(): void {
        for (const plugin of this.plugins) this.installPlugin(plugin);
    }

    private disposePlugin(plugin: DiscoveredPlugin): void {
        const dispose = plugin.dispose;
        plugin.dispose = undefined;
        if (!dispose) return;
        try { dispose(); }
        catch (error) { this.reportPluginError(plugin, 'cleanup', error); }
    }

    private disposePlugins(): void {
        for (const plugin of [...this.plugins].reverse()) this.disposePlugin(plugin);
    }

    pluginNames(): readonly string[] {
        return [
            ...this.plugins.filter(plugin => plugin.dispose).map(plugin => plugin.name),
            ...this.luaHost.pluginNames(),
        ];
    }

    pluginStatus() {
        return [
            ...this.plugins.map(({ name, filename, enabled, dispose, error }) => ({
                id: filename,
                name,
                description: 'Server filesystem plugin module',
                version: '—',
                filename,
                entrypoint: filename,
                fileCount: 1,
                config: {},
                enabled,
                source: 'filesystem' as const,
                status: error ? 'error' : dispose ? 'active' : 'disabled',
                error,
            })),
            ...this.luaHost.pluginStatus(),
        ];
    }

    async togglePlugin(filename: string, enabled: boolean): Promise<boolean> {
        const plugin = this.plugins.find(item => item.filename === filename);
        if (!plugin) return await this.luaHost.togglePlugin(filename, enabled);
        this.db.query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
            .run(`plugin:${filename}`, enabled ? 'enabled' : 'disabled');
        plugin.enabled = enabled;
        if (enabled) {
            plugin.blocked = false;
            this.installPlugin(plugin);
        }
        else this.disposePlugin(plugin);
        return true;
    }

    schedulerStatus() { return { intervalMs: this.updateInterval, running: Boolean(this.updateTimer) }; }

    setUpdateInterval(interval: number) {
        this.db.query("INSERT INTO settings (key, value) VALUES ('plugin_update_interval', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .run(String(interval));
        this.scheduleUpdates(interval);
    }

    private scheduleUpdates(interval: number) {
        clearInterval(this.updateTimer);
        this.updateTimer = undefined;
        this.updateInterval = interval;
        if (!interval) return;
        let last = performance.now();
        this.updateTimer = setInterval(() => {
            const now = performance.now();
            const seconds = (now - last) / 1000;
            last = now;
            principalContext.run({ type: 'system', source: 'plugin-scheduler' }, () => {
                try { this.persist(() => this.world.update(seconds)); }
                catch {
                    clearInterval(this.updateTimer);
                    this.updateTimer = undefined;
                    addActivity({ name: 'plugin:scheduler-paused', category: 'diagnostic', regions: [], data: { intervalMs: interval } });
                }
            });
        }, interval);
        this.updateTimer.unref();
    }

    private restore(bits: number): ServerWorld {
        const world = new Substratum<Record<string, unknown>, Record<string, unknown>, CustomEvents>({
            bits,
            indexedTags: true,
            idFactory: () => {
                return (this.restoreIds ?? []).shift() ?? globalThis.crypto.randomUUID();
            },
        });
        const contents = this.db.query('SELECT id, kind, payload_json FROM contents ORDER BY id').all() as { id: string; kind: string; payload_json: string }[];
        this.restoreIds = contents.map(item => item.id);
        const cells = this.db.query('SELECT address_json, metadata_json FROM cells ORDER BY address_key').all() as { address_json: string; metadata_json: string }[];
        const attachments = this.db.query('SELECT address_key, content_id, metadata_json FROM attachments ORDER BY address_key, content_id').all() as { address_key: string; content_id: string; metadata_json: string }[];
        const byCell = new Map<string, typeof attachments>();
        for (const attachment of attachments) {
            const group = byCell.get(attachment.address_key) ?? [];
            group.push(attachment);
            byCell.set(attachment.address_key, group);
        }
        world.batch(() => {
            for (const item of contents) world.createContent(item.kind, JSON.parse(item.payload_json));
            for (const cell of cells) {
                const address = JSON.parse(cell.address_json) as Address;
                world.setCellMetadata(address, JSON.parse(cell.metadata_json));
                for (const attachment of byCell.get(addressKey(address)) ?? []) {
                    world.attach(address, attachment.content_id as never, JSON.parse(attachment.metadata_json));
                }
            }
        });
        world.validate();
        return world;
    }
    private restoreIds: string[] = [];

    private installPersistence(): void {
        for (const dispose of this.persistDisposers.splice(0)) dispose();
        this.persistDisposers.push(this.world.on('mutation:before', () => {
            if (!this.db.inTransaction) throw new Error('Server mutations must run in a persistence transaction.');
        }));
        for (const name of ['mutation:add', 'mutation:update', 'mutation:remove'] as const) {
            this.persistDisposers.push(this.world.on(name, mutation => this.persistMutation(mutation)));
        }
        for (const name of ['mutation:after', 'mutation:veto'] as const) {
            this.persistDisposers.push(this.world.on(name, mutation => {
                const publish = () => addActivity({
                    name: name === 'mutation:after' ? `mutation:${mutation.operation}` : name,
                    category: name === 'mutation:after' ? 'mutation' : 'veto',
                    regions: mutation.regions,
                    ...(mutation.target === 'cell' ? {} : { contentId: mutation.id, kind: mutation.kind }),
                    data: mutation,
                });
                if (name === 'mutation:veto') publish();
                else this.publishCommitted(publish);
            }));
        }
        this.persistDisposers.push(this.world.on('spatial:change', change => this.publishCommitted(() => {
            addActivity({ name: change.name, category: 'spatial', regions: change.regions, data: { mutations: change.changes.length } });
            for (const transition of change.transitions) {
                addActivity({
                    name: 'content:transition', category: 'transition', regions: [
                        ...transition.added, ...transition.updated, ...transition.removed,
                    ],
                    contentId: transition.id, kind: transition.kind, data: transition,
                });
            }
        })));
        for (const entry of this.listeners) {
            entry.dispose();
            entry.dispose = this.attachListener(entry);
        }
    }

    private publishCommitted(notify: () => void) {
        if (this.afterCommit) this.afterCommit.push(notify);
        else notify();
    }

    private attachListener(entry: { region?: Region; listener: ChangeListener }): () => void {
        const spatial = this.world.on('spatial:change', event => {
            const contentIds = [...new Set(event.changes.flatMap(change => change.target === 'content' ? [change.id] : []))];
            this.publishCommitted(() => entry.listener({ regions: event.regions, contentIds }));
        }, entry.region ? { region: entry.region } : undefined);
        const disposers: (() => void)[] = [spatial];
        if (!entry.region) {
            for (const name of ['mutation:add', 'mutation:update', 'mutation:remove'] as const) {
                disposers.push(this.world.on(name, mutation => {
                    if (!mutation.regions.length && mutation.target === 'content') {
                        this.publishCommitted(() => entry.listener({ regions: [], contentIds: [mutation.id] }));
                    }
                }));
            }
        }
        return () => { for (const dispose of disposers) dispose(); };
    }

    private persistMutation(mutation: ServerMutation): void {
        if (mutation.target === 'content') {
            if (!mutation.id) throw new TypeError('Content mutation is missing its ID.');
            if (mutation.operation === 'remove') this.writeQueries.contentDelete.run(mutation.id);
            else this.writeQueries.contentUpsert.run(mutation.id, mutation.kind, json(mutation.payload, 'Content payload'));
            return;
        }
        if (mutation.target === 'cell') {
            if (!mutation.address) throw new TypeError('Cell mutation is missing its address.');
            const key = addressKey(mutation.address);
            if (mutation.operation === 'remove') {
                const live = this.world.getCell(mutation.address);
                if (live) this.writeQueries.cellUpsert.run(key, json(live.address, 'Cell address'), json(live.metadata, 'Cell metadata'));
                else this.writeQueries.cellDelete.run(key);
            }
            else this.writeQueries.cellUpsert.run(key, json(mutation.address, 'Cell address'), json(mutation.metadata ?? {}, 'Cell metadata'));
            return;
        }
        if (!mutation.address || !mutation.id) throw new TypeError('Attachment mutation is missing its placement.');
        const key = addressKey(mutation.address);
        if (mutation.operation === 'remove') {
            this.writeQueries.attachmentDelete.run(key, mutation.id);
            if (!this.world.getCell(mutation.address)) this.writeQueries.cellDelete.run(key);
        } else {
            this.db.query('INSERT OR IGNORE INTO cells(address_key, address_json, metadata_json) VALUES (?, ?, ?)')
                .run(key, json(mutation.address, 'Cell address'), '{}');
            this.writeQueries.attachmentUpsert.run(key, mutation.id, json(mutation.metadata ?? {}, 'Attachment metadata'));
        }
    }

    transact<T>(run: (world: ServerWorld) => T): T {
        if (this.db.inTransaction) return this.world.batch(() => run(this.world));
        return this.persist(() => this.world.batch(() => run(this.world)));
    }

    private persist<T>(run: () => T): T {
        const start = performance.now();
        try { return this.writeTransaction(run); }
        catch (error) {
            if (!(error instanceof MutationRejected)) {
                this.disposePlugins();
                this.restorePersistedWorld();
                this.installPlugins();
            }
            throw error;
        } finally {
            recordMutation(performance.now() - start);
        }
    }

    private restorePersistedWorld(): void {
        const settings = this.db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'bits'").get();
        this.world = this.restore(Number(settings?.value ?? getConfig().bits));
        this.installPersistence();
    }

    subscribe(listener: ChangeListener, region?: Region): () => void {
        const entry = { region, listener, dispose: () => { } };
        entry.dispose = this.attachListener(entry);
        this.listeners.add(entry);
        return () => { entry.dispose(); this.listeners.delete(entry); };
    }

    emit(name: string, data: unknown, region?: Region): void {
        this.transact(world => {
            const regions = region ? world.geometry.decompose(region, { maxBoxes: 256 }) : [];
            if (region) world.emitAt(name, region, data, { maxBoxes: 256 });
            else world.emit(name, data);
            this.publishCommitted(() => addActivity({ name, category: 'custom', regions, data }));
        });
    }

    snapshot(): Snapshot {
        const contents = this.db.query('SELECT id, kind, payload_json FROM contents ORDER BY id').all() as { id: string; kind: string; payload_json: string }[];
        const cells = this.db.query('SELECT address_key, address_json, metadata_json FROM cells ORDER BY address_key').all() as { address_key: string; address_json: string; metadata_json: string }[];
        const attachments = this.db.query('SELECT address_key, content_id, metadata_json FROM attachments ORDER BY address_key, content_id').all() as { address_key: string; content_id: string; metadata_json: string }[];
        const byCell = new Map<string, { id: string; metadata: Record<string, unknown> }[]>();
        for (const attachment of attachments) {
            const group = byCell.get(attachment.address_key) ?? [];
            group.push({ id: attachment.content_id, metadata: JSON.parse(attachment.metadata_json) });
            byCell.set(attachment.address_key, group);
        }
        return {
            format: 'substratum-atlas/1',
            bits: Number((this.db.query("SELECT value FROM settings WHERE key = 'bits'").get() as { value: string }).value),
            contents: contents.map(item => ({ id: item.id, kind: item.kind, payload: JSON.parse(item.payload_json) })),
            cells: cells.map(cell => ({
                address: JSON.parse(cell.address_json) as Address,
                metadata: JSON.parse(cell.metadata_json),
                attachments: byCell.get(cell.address_key) ?? [],
            })),
        };
    }

    importSnapshot(value: unknown): void {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Snapshot must be an object.');
        const snapshot = value as Partial<Snapshot>;
        if (snapshot.format !== 'substratum-atlas/1' || !Array.isArray(snapshot.contents) || !Array.isArray(snapshot.cells)) {
            throw new TypeError('Expected a substratum-atlas/1 snapshot.');
        }
        const bits = Number((this.db.query("SELECT value FROM settings WHERE key = 'bits'").get() as { value: string }).value);
        if (snapshot.bits !== bits) throw new RangeError(`Snapshot uses ${snapshot.bits} bits; this server is configured for ${bits}.`);
        const contentById = new Map<string, { kind: string; payload: unknown }>();
        for (const item of snapshot.contents) {
            if (!item || typeof item.id !== 'string' || !item.id || typeof item.kind !== 'string' || !item.kind || !Object.hasOwn(item, 'payload')) {
                throw new TypeError('Snapshot contains an invalid content record.');
            }
            if (contentById.has(item.id)) throw new TypeError(`Snapshot contains duplicate content ID "${item.id}".`);
            json(item.payload, 'Content payload');
            contentById.set(item.id, { kind: item.kind, payload: item.payload });
        }
        const cellKeys = new Set<string>();
        for (const cell of snapshot.cells) {
            if (!cell || !Array.isArray(cell.address) || !Array.isArray(cell.attachments)) throw new TypeError('Snapshot contains an invalid cell.');
            const address = this.world.geometry.address(cell.address);
            const key = addressKey(address);
            if (cellKeys.has(key)) throw new TypeError(`Snapshot contains duplicate cell "${key}".`);
            cellKeys.add(key);
            recordObject(cell.metadata, 'Cell metadata');
            const attached = new Set<string>();
            for (const attachment of cell.attachments) {
                if (!attachment || typeof attachment.id !== 'string' || !contentById.has(attachment.id)) throw new TypeError('Snapshot attachment references unknown content.');
                if (attached.has(attachment.id)) throw new TypeError('Snapshot cell contains a duplicate attachment.');
                attached.add(attachment.id);
                const metadata = recordObject(attachment.metadata, 'Attachment metadata');
                if (metadata.kind !== contentById.get(attachment.id)!.kind) throw new TypeError('Attachment metadata.kind must match its content kind.');
            }
            if (!attached.size && !Object.keys(cell.metadata).length) throw new TypeError('Snapshot cannot contain empty cells.');
        }

        const oldWorld = this.world;
        this.disposePlugins();
        let replacement: ServerWorld;
        try {
            replacement = this.db.transaction(() => {
                this.db.exec('DELETE FROM cells; DELETE FROM contents;');
                const insertContent = this.db.query('INSERT INTO contents(id, kind, payload_json) VALUES (?, ?, ?)');
                for (const [id, item] of contentById) insertContent.run(id, item.kind, json(item.payload, 'Content payload'));
                const insertCell = this.db.query('INSERT INTO cells(address_key, address_json, metadata_json) VALUES (?, ?, ?)');
                const insertAttachment = this.db.query('INSERT INTO attachments(address_key, content_id, metadata_json) VALUES (?, ?, ?)');
                for (const cell of snapshot.cells!) {
                    const address = this.world.geometry.address(cell.address);
                    const key = addressKey(address);
                    const metadata = recordObject(cell.metadata, 'Cell metadata');
                    insertCell.run(key, json(address, 'Cell address'), json(metadata, 'Cell metadata'));
                    for (const attachment of cell.attachments) {
                        insertAttachment.run(key, attachment.id, json(attachment.metadata, 'Attachment metadata'));
                    }
                }
                return this.restore(bits);
            })();
        } catch (error) {
            this.world = oldWorld;
            this.installPersistence();
            this.installPlugins();
            throw error;
        }
        this.world = replacement;
        this.installPersistence();
        this.installPlugins();
        const change = { regions: [this.world.geometry.address(['', '', ''])], contentIds: [], reset: true };
        for (const entry of this.listeners) entry.listener(change);
    }
}

function recordObject(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
    return value as Record<string, unknown>;
}

let service: Promise<RuntimeService> | undefined;
export function getRuntime(): Promise<RuntimeService> {
    if (!service) {
        service = new RuntimeService().initialize().catch(error => {
            console.error('Substratum Server initialization failed:', error instanceof Error ? error.message : 'unknown error');
            service = undefined;
            throw error;
        });
    }
    return service;
}
