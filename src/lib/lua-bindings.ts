import { AsyncLocalStorage } from 'node:async_hooks';
import type { Address, Bounds, Extent, ExtentOptions, NearestOptions, QueryOptions, Region, SearchOptions, Vec3 } from '@svaltek/substratum';
import {
    bindingDocs,
    jsonBindings,
    LuaBinder,
    LuaBinding,
    LuaBindings,
    type BindingContext,
    type LuaBindingDocs,
} from 'webluabridge';
import { addActivity } from './activity/journal';
import { currentPrincipal, type Principal } from './principal';
import type { RuntimeService, ServerWorld } from './runtime';

const currentPluginStorage = new AsyncLocalStorage<string>();
let disposerRegistrar: ((pluginId: string, dispose: () => void) => void) | null = null;

export function runInLuaPluginScope<T>(pluginName: string, fn: () => T): T {
    return currentPluginStorage.run(pluginName, fn);
}

export function setLuaDisposerRegistrar(registrar: ((pluginId: string, dispose: () => void) => void) | null): void {
    disposerRegistrar = registrar;
}

let activeServer: RuntimeService | null = null;
let txDepth = 0;

export function setLuaBindingsRuntime(server: RuntimeService | null): void {
    activeServer = server;
}

function requireServer(): RuntimeService {
    if (!activeServer) throw new Error('Substratum runtime is not initialized.');
    return activeServer;
}

function inTransaction<T>(fn: (world: ServerWorld) => T): T {
    const server = requireServer();
    if (txDepth > 0) return fn(server.world);
    return server.transact(world => {
        txDepth++;
        try { return fn(world); }
        finally { txDepth--; }
    });
}

function take<T>(iter: Iterable<T>, limit = 250): T[] {
    const out: T[] = [];
    for (const item of iter) {
        if (out.length >= limit) break;
        out.push(item);
    }
    return out;
}

function registerDisposer(dispose: () => void): () => void {
    const pluginId = currentPluginStorage.getStore();
    if (pluginId && disposerRegistrar) {
        disposerRegistrar(pluginId, dispose);
    }
    return dispose;
}

@LuaBinder({ namespace: 'world', readonly: true })
export class SubstratumWorldBindings extends LuaBindings {
    @LuaBinding({
        name: 'stats',
        description: 'Return runtime statistics (cells, attachments, contents, orphans, bits).',
        returnType: 'table',
    })
    static stats() {
        const server = requireServer();
        return { bits: server.world.bits, ...server.world.stats() };
    }

    @LuaBinding({
        name: 'getCell',
        description: 'Inspect a cell at an exact binary-prefix address.',
        args: [{ name: 'address', type: 'string[3]' }],
        returnType: 'table | nil',
    })
    static getCell(address: Address) {
        return requireServer().world.getCell(address) ?? null;
    }

    @LuaBinding({
        name: 'getContent',
        description: 'Read a content payload by content ID.',
        args: [{ name: 'id', type: 'string' }],
        returnType: 'any',
    })
    static getContent(id: string) {
        const server = requireServer();
        return server.world.hasContent(id as never) ? server.world.getContent(id as never) : null;
    }

    @LuaBinding({
        name: 'hasContent',
        description: 'Check whether a content ID exists.',
        args: [{ name: 'id', type: 'string' }],
        returnType: 'boolean',
    })
    static hasContent(id: string): boolean {
        return requireServer().world.hasContent(id as never);
    }

    @LuaBinding({
        name: 'placements',
        description: 'List all cell addresses where a content ID is attached.',
        args: [{ name: 'id', type: 'string' }],
        returnType: 'Address[]',
    })
    static placements(id: string) {
        return requireServer().world.placements(id as never);
    }

    @LuaBinding({
        name: 'orphans',
        description: 'List all unattached content IDs.',
        returnType: 'string[]',
    })
    static orphans() {
        return [...requireServer().world.orphans()];
    }

    @LuaBinding({
        name: 'search',
        description: 'Search attachments in a region (optional options.limit, default 250).',
        args: [{ name: 'region', type: 'Region?' }, { name: 'options', type: 'table?' }],
        returnType: 'table[]',
    })
    static search(region?: Region, options?: SearchOptions<Record<string, unknown>, string> & { limit?: number }) {
        return take(requireServer().world.search(region, options), options?.limit ?? 250);
    }

    @LuaBinding({
        name: 'searchContent',
        description: 'Search unique content records in a region (optional options.limit, default 250).',
        args: [{ name: 'region', type: 'Region?' }, { name: 'options', type: 'table?' }],
        returnType: 'table[]',
    })
    static searchContent(region?: Region, options?: SearchOptions<Record<string, unknown>, string> & { limit?: number }) {
        return take(requireServer().world.searchContent(region, options), options?.limit ?? 250);
    }

    @LuaBinding({
        name: 'nearest',
        description: 'Find nearest unique content records from an [x, y, z] point.',
        args: [{ name: 'at', type: 'number[3]' }, { name: 'options', type: 'table?' }],
        returnType: 'table[]',
    })
    static nearest(at: Vec3, options?: NearestOptions<Record<string, unknown>, string>) {
        return take(requireServer().world.nearestContent(at, options), options?.limit ?? 20);
    }

    @LuaBinding({
        name: 'nearestAttachments',
        description: 'Find nearest attachment records from an [x, y, z] point.',
        args: [{ name: 'at', type: 'number[3]' }, { name: 'options', type: 'table?' }],
        returnType: 'table[]',
    })
    static nearestAttachments(at: Vec3, options?: NearestOptions<Record<string, unknown>, string>) {
        return take(requireServer().world.nearest(at, options), options?.limit ?? 20);
    }

    @LuaBinding({
        name: 'radius',
        description: 'Find unique content records within a radius of [x, y, z].',
        args: [{ name: 'at', type: 'number[3]' }, { name: 'radius', type: 'number' }, { name: 'options', type: 'table?' }],
        returnType: 'table[]',
    })
    static radius(at: Vec3, r: number, options?: QueryOptions<Record<string, unknown>, string> & { limit?: number }) {
        return take(requireServer().world.radiusContent(at, r, options), options?.limit ?? 250);
    }

    @LuaBinding({
        name: 'radiusAttachments',
        description: 'Find attachment records within a radius of [x, y, z].',
        args: [{ name: 'at', type: 'number[3]' }, { name: 'radius', type: 'number' }, { name: 'options', type: 'table?' }],
        returnType: 'table[]',
    })
    static radiusAttachments(at: Vec3, r: number, options?: QueryOptions<Record<string, unknown>, string> & { limit?: number }) {
        return take(requireServer().world.radius(at, r, options), options?.limit ?? 250);
    }
}

@LuaBinder({ namespace: 'geometry', readonly: true })
export class SubstratumGeometryBindings extends LuaBindings {
    @LuaBinding({
        name: 'encode',
        description: 'Encode a signed integer coordinate into a binary string.',
        args: [{ name: 'value', type: 'number' }],
        returnType: 'string',
    })
    static encode(value: number): string {
        return requireServer().world.geometry.encode(value);
    }

    @LuaBinding({
        name: 'decode',
        description: 'Decode a binary prefix string into an inclusive [min, max] integer interval.',
        args: [{ name: 'prefix', type: 'string' }],
        returnType: 'number[2]',
    })
    static decode(prefix: string) {
        return requireServer().world.geometry.decode(prefix);
    }

    @LuaBinding({
        name: 'address',
        description: 'Validate and normalize a 3-axis binary-prefix address tuple.',
        args: [{ name: 'address', type: 'string[3]' }],
        returnType: 'Address',
    })
    static address(addr: Address) {
        return requireServer().world.geometry.address(addr);
    }

    @LuaBinding({
        name: 'point',
        description: 'Encode an [x, y, z] integer coordinate into an exact cell address.',
        args: [{ name: 'xyz', type: 'number[3]' }],
        returnType: 'Address',
    })
    static point(xyz: Vec3) {
        return requireServer().world.geometry.point(xyz);
    }

    @LuaBinding({
        name: 'cover',
        description: 'Compute the minimal enclosing cell address for a region.',
        args: [{ name: 'region', type: 'Region' }],
        returnType: 'Address',
    })
    static cover(region: Region) {
        return requireServer().world.geometry.cover(region);
    }

    @LuaBinding({
        name: 'bounds',
        description: 'Return inclusive [[x0,x1],[y0,y1],[z0,z1]] bounds for a region.',
        args: [{ name: 'region', type: 'Region' }],
        returnType: 'Bounds',
    })
    static bounds(region: Region) {
        return requireServer().world.geometry.boundsOf(region);
    }

    @LuaBinding({
        name: 'extentBounds',
        description: 'Compute inclusive bounds for an [x, y, z] origin with optional scalar or [dx, dy, dz] extent.',
        args: [{ name: 'xyz', type: 'number[3]' }, { name: 'extent', type: 'number | number[3]?' }],
        returnType: 'Bounds',
    })
    static extentBounds(xyz: Vec3, extent?: Extent) {
        return requireServer().world.geometry.extentBounds(xyz, extent);
    }

    @LuaBinding({
        name: 'decompose',
        description: 'Decompose a region into exact binary-prefix addresses.',
        args: [{ name: 'region', type: 'Region' }, { name: 'maxBoxes', type: 'number?' }],
        returnType: 'Address[]',
    })
    static decompose(region: Region, maxBoxes = 256) {
        return requireServer().world.geometry.decompose(region, { maxBoxes });
    }

    @LuaBinding({
        name: 'decomposeExtent',
        description: 'Decompose an [x, y, z] + extent box into exact binary-prefix addresses.',
        args: [{ name: 'xyz', type: 'number[3]' }, { name: 'extent', type: 'number | number[3]?' }, { name: 'maxBoxes', type: 'number?' }],
        returnType: 'Address[]',
    })
    static decomposeExtent(xyz: Vec3, extent?: Extent, maxBoxes = 256) {
        return requireServer().world.geometry.decomposeExtent(xyz, extent, { maxBoxes });
    }

    @LuaBinding({
        name: 'decomposeBounds',
        description: 'Decompose inclusive [[x0,x1],[y0,y1],[z0,z1]] bounds into exact binary-prefix addresses.',
        args: [{ name: 'bounds', type: 'Bounds' }, { name: 'maxBoxes', type: 'number?' }],
        returnType: 'Address[]',
    })
    static decomposeBounds(bounds: Bounds, maxBoxes = 256) {
        return requireServer().world.geometry.decomposeBounds(bounds, { maxBoxes });
    }
}

@LuaBinder({ namespace: 'plugin', readonly: true })
export class SubstratumPluginBindings extends LuaBindings {
    @LuaBinding({
        name: 'put',
        description: 'Create and attach content at an address inside a SQLite-backed transaction.',
        args: [{ name: 'address', type: 'Address' }, { name: 'metadata', type: 'table' }, { name: 'payload', type: 'any' }],
        returnType: 'string',
    })
    static put(address: Address, metadata: Record<string, unknown>, payload: unknown): string {
        return inTransaction(world => world.put(address, metadata as never, payload));
    }

    @LuaBinding({
        name: 'putPoint',
        description: 'Create and attach content across an [x, y, z] + extent box inside a transaction.',
        args: [{ name: 'xyz', type: 'number[3]' }, { name: 'metadata', type: 'table' }, { name: 'payload', type: 'any' }, { name: 'options', type: 'table?' }],
        returnType: 'string',
    })
    static putPoint(xyz: Vec3, metadata: Record<string, unknown>, payload: unknown, options?: ExtentOptions): string {
        return inTransaction(world => world.putPoint(xyz, metadata as never, payload, options));
    }

    @LuaBinding({
        name: 'createContent',
        description: 'Create an unattached content record inside a transaction.',
        args: [{ name: 'kind', type: 'string' }, { name: 'payload', type: 'any' }],
        returnType: 'string',
    })
    static createContent(kind: string, payload: unknown): string {
        return inTransaction(world => world.createContent(kind, payload));
    }

    @LuaBinding({
        name: 'setContent',
        description: 'Replace the JSON payload of an existing content ID inside a transaction.',
        args: [{ name: 'id', type: 'string' }, { name: 'payload', type: 'any' }],
        returnType: 'string',
    })
    static setContent(id: string, payload: unknown): string {
        return inTransaction(world => world.setContent(id as never, payload));
    }

    @LuaBinding({
        name: 'touchContent',
        description: 'Re-emit a content update for an existing content ID without changing its payload.',
        args: [{ name: 'id', type: 'string' }],
        returnType: 'string',
    })
    static touchContent(id: string): string {
        return inTransaction(world => world.touchContent(id as never));
    }

    @LuaBinding({
        name: 'removeContent',
        description: 'Remove an unattached content record inside a transaction.',
        args: [{ name: 'id', type: 'string' }],
        returnType: 'boolean',
    })
    static removeContent(id: string): boolean {
        return inTransaction(world => world.removeContent(id as never));
    }

    @LuaBinding({
        name: 'attach',
        description: 'Attach an existing content ID to an address inside a transaction.',
        args: [{ name: 'address', type: 'Address' }, { name: 'id', type: 'string' }, { name: 'metadata', type: 'table?' }],
        returnType: 'string',
    })
    static attach(address: Address, id: string, metadata?: Record<string, unknown>): string {
        return inTransaction(world => world.attach(address, id as never, (metadata ?? {}) as never));
    }

    @LuaBinding({
        name: 'attachPoint',
        description: 'Attach an existing content ID across an [x, y, z] + extent box inside a transaction.',
        args: [{ name: 'xyz', type: 'number[3]' }, { name: 'id', type: 'string' }, { name: 'metadata', type: 'table?' }, { name: 'options', type: 'table?' }],
        returnType: 'string',
    })
    static attachPoint(xyz: Vec3, id: string, metadata?: Record<string, unknown>, options?: ExtentOptions): string {
        return inTransaction(world => world.attachPoint(xyz, id as never, (metadata ?? {}) as never, options));
    }

    @LuaBinding({
        name: 'updateAttachment',
        description: 'Update metadata for an existing attachment at an address inside a transaction.',
        args: [{ name: 'address', type: 'Address' }, { name: 'id', type: 'string' }, { name: 'metadata', type: 'table' }],
        returnType: 'string',
    })
    static updateAttachment(address: Address, id: string, metadata: Record<string, unknown>): string {
        return inTransaction(world => world.updateAttachment(address, id as never, metadata as never));
    }

    @LuaBinding({
        name: 'moveContent',
        description: 'Replace all placements of a content ID with a new [x, y, z] + extent box inside a transaction.',
        args: [{ name: 'id', type: 'string' }, { name: 'xyz', type: 'number[3]' }, { name: 'options', type: 'table?' }],
        returnType: 'Address[]',
    })
    static moveContent(id: string, xyz: Vec3, options?: ExtentOptions & { metadata?: Record<string, unknown> }) {
        return inTransaction(world => world.moveContent(id as never, xyz, options as never));
    }

    @LuaBinding({
        name: 'detach',
        description: 'Detach a content ID from an address inside a transaction.',
        args: [{ name: 'address', type: 'Address' }, { name: 'id', type: 'string' }],
        returnType: 'boolean',
    })
    static detach(address: Address, id: string): boolean {
        return inTransaction(world => world.detach(address, id as never));
    }

    @LuaBinding({
        name: 'detachAll',
        description: 'Detach all placements of a content ID inside a transaction.',
        args: [{ name: 'id', type: 'string' }],
        returnType: 'number',
    })
    static detachAll(id: string): number {
        return inTransaction(world => world.detachAll(id as never));
    }

    @LuaBinding({
        name: 'setCellMetadata',
        description: 'Replace metadata on a cell inside a transaction.',
        args: [{ name: 'address', type: 'Address' }, { name: 'metadata', type: 'table' }],
        returnType: 'Address',
    })
    static setCellMetadata(address: Address, metadata: Record<string, unknown>) {
        return inTransaction(world => world.setCellMetadata(address, metadata));
    }

    @LuaBinding({
        name: 'clearCell',
        description: 'Clear a cell and all of its attachments inside a transaction.',
        args: [{ name: 'address', type: 'Address' }],
        returnType: 'boolean',
    })
    static clearCell(address: Address): boolean {
        return inTransaction(world => world.clearCell(address));
    }

    @LuaBinding({
        name: 'clearPoint',
        description: 'Clear the cell at an [x, y, z] coordinate inside a transaction.',
        args: [{ name: 'xyz', type: 'number[3]' }],
        returnType: 'boolean',
    })
    static clearPoint(xyz: Vec3): boolean {
        return inTransaction(world => world.clearPoint(xyz));
    }

    @LuaBinding({
        name: 'collectOrphans',
        description: 'Remove all unattached content records inside a transaction and return their IDs.',
        returnType: 'string[]',
    })
    static collectOrphans() {
        return inTransaction(world => [...world.collectOrphans()]);
    }

    @LuaBinding({
        name: 'transact',
        description: 'Execute a Lua callback atomically inside a single Substratum + SQLite transaction.',
        args: [{ name: 'fn', type: 'function' }],
        returnType: 'any',
    })
    static transact(fn: () => unknown): unknown {
        if (typeof fn !== 'function') throw new TypeError('transact requires a callback function.');
        return inTransaction(() => fn());
    }

    @LuaBinding({
        name: 'on',
        description: 'Subscribe to any world event (custom, spatial:change, mutation:*, update*) optionally scoped to a Region. Returns an unsubscribe function.',
        args: [{ name: 'event', type: 'string' }, { name: 'handler', type: 'function' }, { name: 'region', type: 'Region?' }],
        returnType: 'function',
    })
    static on(event: string, handler: (payload: unknown) => void, region?: Region): () => void {
        if (typeof event !== 'string' || !event) throw new TypeError('Event name must be a non-empty string.');
        if (typeof handler !== 'function') throw new TypeError('Event handler must be a function.');
        const pluginId = currentPluginStorage.getStore() ?? 'lua';
        const on = requireServer().world.on as (event: string, listener: (payload: unknown) => void, region?: Region) => () => void;
        const dispose = on(event, payload => {
            runInLuaPluginScope(pluginId, () => handler(payload));
        }, region);
        return registerDisposer(dispose);
    }

    @LuaBinding({
        name: 'middleware',
        description: 'Register synchronous mutation middleware. Return false to veto, or return a patch table ({ metadata } or { payload }) to transform the mutation. Returns an unsubscribe function.',
        args: [{ name: 'handler', type: 'function' }],
        returnType: 'function',
    })
    static middleware(handler: (mutation: unknown) => unknown): () => void {
        if (typeof handler !== 'function') throw new TypeError('Middleware handler must be a function.');
        const pluginId = currentPluginStorage.getStore() ?? 'lua';
        const dispose = requireServer().world.middleware((mutation, next) => {
            const result = runInLuaPluginScope(pluginId, () => handler(mutation));
            if (result === false) return;
            if (result && typeof result === 'object' && !Array.isArray(result)) {
                const patch = result as Record<string, unknown>;
                if (mutation.target === 'cell') {
                    next({ target: 'cell', metadata: (patch.metadata ?? mutation.metadata ?? {}) as Record<string, unknown> });
                } else if (mutation.target === 'attachment') {
                    next({ target: 'attachment', kind: mutation.kind, metadata: (patch.metadata ?? mutation.metadata ?? {}) as never });
                } else {
                    next({ target: 'content', kind: mutation.kind, payload: Object.hasOwn(patch, 'payload') ? patch.payload : mutation.payload });
                }
                return;
            }
            next();
        });
        return registerDisposer(dispose);
    }

    @LuaBinding({
        name: 'emit',
        description: 'Emit a custom Substratum event globally or scoped to a region.',
        args: [{ name: 'name', type: 'string' }, { name: 'data', type: 'any?' }, { name: 'region', type: 'Region?' }],
    })
    static emit(name: string, data?: unknown, region?: Region) {
        requireServer().emit(name, data ?? null, region);
    }

    @LuaBinding({
        name: 'log',
        description: 'Write a structured diagnostic log entry for this plugin.',
        args: [{ name: 'level', type: '"info"|"warn"|"error"' }, { name: 'message', type: 'string' }],
    })
    static log(level: 'info' | 'warn' | 'error', message: string) {
        const source = currentPluginStorage.getStore() ?? 'lua';
        addActivity({
            name: 'plugin:log',
            category: 'diagnostic',
            source,
            level: level === 'warn' || level === 'error' ? level : 'info',
            regions: [],
            data: { name: source, level, message: String(message).slice(0, 1000) },
        });
    }

    @LuaBinding({
        name: 'principal',
        description: 'Return the authenticated principal for the current operation.',
        returnType: 'table',
    })
    static principal(): Principal {
        return currentPrincipal();
    }

    @LuaBinding({
        name: 'getConfig',
        description: 'Read a configuration value for the current plugin, returning defaultVal if unset.',
        args: [{ name: 'key', type: 'string' }, { name: 'defaultVal', type: 'any?' }],
        returnType: 'any',
    })
    static getConfig(key: string, defaultVal?: unknown): unknown {
        const pluginId = currentPluginStorage.getStore();
        if (!pluginId) return defaultVal ?? null;
        const cfg = requireServer().luaHost.getPluginConfig(pluginId);
        return Object.hasOwn(cfg, key) ? cfg[key] : (defaultVal ?? null);
    }

    @LuaBinding({
        name: 'setConfig',
        description: 'Persist a configuration key-value pair for the current plugin.',
        args: [{ name: 'key', type: 'string' }, { name: 'value', type: 'any' }],
    })
    static setConfig(key: string, value: unknown): void {
        const pluginId = currentPluginStorage.getStore();
        if (!pluginId) return;
        requireServer().luaHost.setPluginConfigKey(pluginId, String(key), value);
    }
}

export const substratumLuaBindings = [
    (ctx: BindingContext) => new SubstratumWorldBindings(ctx),
    (ctx: BindingContext) => new SubstratumGeometryBindings(ctx),
    (ctx: BindingContext) => new SubstratumPluginBindings(ctx),
    jsonBindings,
];

export function getLuaBindingDocs(): LuaBindingDocs[] {
    return [
        bindingDocs(SubstratumWorldBindings),
        bindingDocs(SubstratumGeometryBindings),
        bindingDocs(SubstratumPluginBindings),
    ];
}
