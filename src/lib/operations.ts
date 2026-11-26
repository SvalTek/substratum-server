import { cpuUsage, memoryUsage, uptime } from 'node:process';
import { getConfig } from './config';
import { metrics } from './metrics';
import { activityRetention, queryActivity } from './activity/journal';
import { listClients } from './clients';
import type { RuntimeService } from './runtime';

export function settings(server: RuntimeService) {
    const config = getConfig();
    return {
        startup: {
            host: config.host,
            port: config.port,
            databasePath: config.databasePath,
            pluginsDirectory: config.pluginsDirectory,
            bits: server.world.bits,
            sessionTtlSeconds: config.sessionTtlSeconds,
            cookieSecure: config.cookieSecure,
            publicOrigin: config.publicOrigin ?? null,
        },
        runtime: {
            scheduler: server.schedulerStatus(),
            activeDashboardSessions: server.db.query<{ count: number }, [number]>(
                'SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?',
            ).get(Date.now())!.count,
        },
        logging: { runtimeDiagnostics: 'SQLite activity_log', limit: activityRetention() },
    };
}

export function diagnostics(server: RuntimeService) {
    const cpu = cpuUsage();
    const seconds = uptime();
    const clients = listClients();
    return {
        memory: memoryUsage(),
        cpu: { userMicros: cpu.user, systemMicros: cpu.system, averagePercent: (cpu.user + cpu.system) / (Math.max(1, seconds) * 10000) },
        uptimeSeconds: seconds,
        runtime: server.world.stats(),
        performance: metrics(),
        clients: {
            registered: clients.length,
            activeStreams: clients.reduce((sum, item) => sum + item.connections, 0),
        },
        errors: queryActivity({ category: 'diagnostic', limit: 50 }).events,
    };
}

export function storageInfo(server: RuntimeService) {
    const counts = server.db.query<{ cells: number; attachments: number; contents: number; orphans: number }, []>(`
        SELECT
          (SELECT COUNT(*) FROM cells) AS cells,
          (SELECT COUNT(*) FROM attachments) AS attachments,
          (SELECT COUNT(*) FROM contents) AS contents,
          (SELECT COUNT(*) FROM contents WHERE NOT EXISTS
            (SELECT 1 FROM attachments WHERE content_id = contents.id)) AS orphans
    `).get()!;
    const { cells, attachments, contents, orphans } = server.world.stats();
    const runtime = { cells, attachments, contents, orphans };
    const backups = server.db.query<{ id: string; label: string; createdAt: number; bytes: number }, []>(`
        SELECT id, label, created_at AS createdAt, length(CAST(snapshot_json AS BLOB)) AS bytes
        FROM backups ORDER BY created_at DESC LIMIT 100
    `).all();
    return { counts, runtime, matching: Object.keys(counts).every(key => counts[key as keyof typeof counts] === runtime[key as keyof typeof runtime]), backups };
}

export function validateStorage(server: RuntimeService) {
    const database = server.db.query<{ quick_check: string }, []>('PRAGMA quick_check').all().map(item => item.quick_check);
    const foreignKeys = server.db.query('PRAGMA foreign_key_check').all().length;
    let runtime = true;
    try { server.world.validate(); } catch { runtime = false; }
    const { matching: countsMatch } = storageInfo(server);
    const snapshot = server.snapshot();
    const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
    const matching = countsMatch && snapshot.contents.every(item =>
        server.world.hasContent(item.id as never) && same(server.world.getContent(item.id as never), item.payload),
    ) && snapshot.cells.every(item => {
        const live = server.world.getCell(item.address);
        if (!live || !same(live.metadata, item.metadata)) return false;
        const attachments = new Map(live.attachments.map(attachment => [String(attachment.id), attachment.metadata]));
        return attachments.size === item.attachments.length && item.attachments.every(attachment =>
            same(attachments.get(attachment.id), attachment.metadata),
        );
    });
    return { ok: database.length === 1 && database[0] === 'ok' && !foreignKeys && runtime && matching, database, foreignKeys, runtime, matching };
}

export function createBackup(server: RuntimeService, label: string) {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    server.db.query('INSERT INTO backups(id, label, created_at, snapshot_json) VALUES (?, ?, ?, ?)')
        .run(id, label, createdAt, JSON.stringify(server.snapshot()));
    return { id, label, createdAt };
}

export function backup(server: RuntimeService, id: string) {
    const row = server.db.query<{ snapshot: string }, [string]>('SELECT snapshot_json AS snapshot FROM backups WHERE id = ?').get(id);
    return row ? JSON.parse(row.snapshot) : undefined;
}

export function deleteBackup(server: RuntimeService, id: string): boolean {
    const { changes } = server.db.query('DELETE FROM backups WHERE id = ?').run(id);
    return Boolean(changes);
}
