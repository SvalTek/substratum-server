import { AsyncLocalStorage } from 'node:async_hooks';
import type { Address, QueryOptions, Region, Vec3 } from '@svaltek/substratum';
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
import type { RuntimeService } from './runtime';

const currentPluginStorage = new AsyncLocalStorage<string>();

export function runInLuaPluginScope<T>(pluginName: string, fn: () => T): T {
    return currentPluginStorage.run(pluginName, fn);
}

let activeServer: RuntimeService | null = null;

export function setLuaBindingsRuntime(server: RuntimeService | null): void {
    activeServer = server;
}

function requireServer(): RuntimeService {
    if (!activeServer) throw new Error('Substratum runtime is not initialized.');
    return activeServer;
}

function take<T>(iter: Iterable<T>, limit = 250): T[] {
    const out: T[] = [];
    for (const item of iter) {
        if (out.length >= limit) break;
        out.push(item);
    }
    return out;
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
        name: 'search',
        description: 'Search attachments in a region (capped at 250 results).',
        args: [{ name: 'region', type: 'Region' }, { name: 'options', type: 'table?' }],
        returnType: 'table[]',
    })
    static search(region: Region, options?: QueryOptions<Record<string, unknown>, string>) {
        return take(requireServer().world.search(region, options));
    }

    @LuaBinding({
        name: 'searchContent',
        description: 'Search unique content records in a region (capped at 250 results).',
        args: [{ name: 'region', type: 'Region' }, { name: 'options', type: 'table?' }],
        returnType: 'table[]',
    })
    static searchContent(region: Region, options?: QueryOptions<Record<string, unknown>, string>) {
        return take(requireServer().world.searchContent(region, options));
    }

    @LuaBinding({
        name: 'nearest',
        description: 'Find nearest unique content records from an [x, y, z] point.',
        args: [{ name: 'at', type: 'number[3]' }, { name: 'options', type: 'table?' }],
        returnType: 'table[]',
    })
    static nearest(at: Vec3, options?: QueryOptions<Record<string, unknown>, string> & { limit?: number }) {
        return take(requireServer().world.nearestContent(at, options), options?.limit ?? 20);
    }

    @LuaBinding({
        name: 'radius',
        description: 'Find unique content records within a radius of [x, y, z].',
        args: [{ name: 'at', type: 'number[3]' }, { name: 'radius', type: 'number' }, { name: 'options', type: 'table?' }],
        returnType: 'table[]',
    })
    static radius(at: Vec3, r: number, options?: QueryOptions<Record<string, unknown>, string>) {
        return take(requireServer().world.radiusContent(at, r, options));
    }
}

@LuaBinder({ namespace: 'geometry', readonly: true })
export class SubstratumGeometryBindings extends LuaBindings {
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
        name: 'decompose',
        description: 'Decompose a region into exact binary-prefix addresses.',
        args: [{ name: 'region', type: 'Region' }, { name: 'maxBoxes', type: 'number?' }],
        returnType: 'Address[]',
    })
    static decompose(region: Region, maxBoxes = 256) {
        return requireServer().world.geometry.decompose(region, { maxBoxes });
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
        return requireServer().transact(world => world.put(address, metadata as never, payload));
    }

    @LuaBinding({
        name: 'createContent',
        description: 'Create an unattached content record inside a transaction.',
        args: [{ name: 'kind', type: 'string' }, { name: 'payload', type: 'any' }],
        returnType: 'string',
    })
    static createContent(kind: string, payload: unknown): string {
        return requireServer().transact(world => world.createContent(kind, payload));
    }

    @LuaBinding({
        name: 'attach',
        description: 'Attach an existing content ID to an address inside a transaction.',
        args: [{ name: 'address', type: 'Address' }, { name: 'id', type: 'string' }, { name: 'metadata', type: 'table?' }],
    })
    static attach(address: Address, id: string, metadata?: Record<string, unknown>) {
        requireServer().transact(world => world.attach(address, id as never, metadata as never));
    }

    @LuaBinding({
        name: 'detach',
        description: 'Detach a content ID from an address inside a transaction.',
        args: [{ name: 'address', type: 'Address' }, { name: 'id', type: 'string' }],
        returnType: 'boolean',
    })
    static detach(address: Address, id: string): boolean {
        return requireServer().transact(world => world.detach(address, id as never));
    }

    @LuaBinding({
        name: 'setCellMetadata',
        description: 'Replace metadata on a cell inside a transaction.',
        args: [{ name: 'address', type: 'Address' }, { name: 'metadata', type: 'table' }],
    })
    static setCellMetadata(address: Address, metadata: Record<string, unknown>) {
        requireServer().transact(world => world.setCellMetadata(address, metadata));
    }

    @LuaBinding({
        name: 'emit',
        description: 'Emit a custom Substratum event globally or scoped to a region.',
        args: [{ name: 'name', type: 'string' }, { name: 'data', type: 'any' }, { name: 'region', type: 'Region?' }],
    })
    static emit(name: string, data: unknown, region?: Region) {
        requireServer().emit(name, data, region);
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
