import { getDatabase } from '../database';
import { currentPrincipal } from '../principal';
import { recordEvent } from '../metrics';
import type { ActivityCategory, ActivityEvent } from './types';

const DEFAULT_RETENTION = 2000;
const listeners = new Set<(event: ActivityEvent) => void>();
const instance = crypto.randomUUID().slice(0, 8);
let sequence = 0;

interface ActivityRow {
    id: string;
    time: number;
    name: string;
    category: ActivityCategory;
    regions_json: string;
    content_id: string | null;
    kind: string | null;
    source: string | null;
    level: 'info' | 'warn' | 'error' | null;
    principal_json: string;
    data_json: string;
}

export function activityRetention(): number {
    try {
        const row = getDatabase().query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'activity_retention'").get();
        const parsed = row ? Number(row.value) : DEFAULT_RETENTION;
        return Number.isInteger(parsed) && parsed >= 100 && parsed <= 20000 ? parsed : DEFAULT_RETENTION;
    } catch {
        return DEFAULT_RETENTION;
    }
}

export function setActivityRetention(limit: number): number {
    if (!Number.isInteger(limit) || limit < 100 || limit > 20000) {
        throw new RangeError('Activity retention must be an integer between 100 and 20000.');
    }
    getDatabase().query("INSERT INTO settings(key, value) VALUES ('activity_retention', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(limit));
    pruneActivity(limit);
    return limit;
}

function pruneActivity(retention = activityRetention()) {
    getDatabase().query(`
        DELETE FROM activity_log WHERE id NOT IN (
            SELECT id FROM activity_log ORDER BY time DESC, rowid DESC LIMIT ?
        )
    `).run(retention);
}

function rowToEvent(row: ActivityRow): ActivityEvent {
    return {
        id: row.id,
        time: row.time,
        name: row.name,
        category: row.category,
        regions: JSON.parse(row.regions_json),
        ...(row.content_id ? { contentId: row.content_id } : {}),
        ...(row.kind ? { kind: row.kind } : {}),
        ...(row.source ? { source: row.source } : {}),
        ...(row.level ? { level: row.level } : {}),
        principal: JSON.parse(row.principal_json),
        data: JSON.parse(row.data_json),
    };
}

export function addActivity(event: Omit<ActivityEvent, 'id' | 'time' | 'principal'>) {
    let data: unknown;
    try {
        const encoded = JSON.stringify(event.data);
        data = encoded && encoded.length <= 16000 ? JSON.parse(encoded) : { truncated: true };
    } catch {
        data = { unavailable: true };
    }
    const entry: ActivityEvent = {
        ...event,
        data,
        regions: event.regions.slice(0, 256),
        id: `${instance}:${++sequence}`,
        time: Date.now(),
        principal: currentPrincipal(),
    };
    try {
        const db = getDatabase();
        db.query(`
            INSERT INTO activity_log (id, time, name, category, regions_json, content_id, kind, source, level, principal_json, data_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            entry.id,
            entry.time,
            entry.name,
            entry.category,
            JSON.stringify(entry.regions),
            entry.contentId ?? null,
            entry.kind ?? null,
            entry.source ?? null,
            entry.level ?? null,
            JSON.stringify(entry.principal),
            JSON.stringify(entry.data ?? null),
        );
        if (sequence % 50 === 0) pruneActivity();
    } catch {
        // Never allow journal persistence failure to abort the active operation.
    }
    if (event.category !== 'diagnostic') recordEvent();
    for (const listener of listeners) listener(entry);
}

export function queryActivity(options: {
    category?: string;
    name?: string;
    kind?: string;
    contentId?: string;
    source?: string;
    limit?: number;
    offset?: number;
} = {}): { events: ActivityEvent[]; total: number } {
    const db = getDatabase();
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (options.category) { clauses.push('category = ?'); params.push(options.category); }
    if (options.name) { clauses.push('LOWER(name) LIKE ?'); params.push(`%${options.name.toLowerCase()}%`); }
    if (options.kind) { clauses.push('kind = ?'); params.push(options.kind); }
    if (options.contentId) { clauses.push('content_id = ?'); params.push(options.contentId); }
    if (options.source) { clauses.push('source = ?'); params.push(options.source); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(500, Math.max(1, options.limit ?? 256));
    const offset = Math.max(0, options.offset ?? 0);
    const total = db.query<{ total: number }, (string | number)[]>(`SELECT COUNT(*) AS total FROM activity_log ${where}`).get(...params)!.total;
    const rows = db.query<ActivityRow, (string | number)[]>(
        `SELECT id, time, name, category, regions_json, content_id, kind, source, level, principal_json, data_json
         FROM activity_log ${where} ORDER BY time DESC, rowid DESC LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset);
    return { events: rows.map(rowToEvent), total };
}

export function activitySnapshot(limit = 256): ActivityEvent[] {
    return queryActivity({ limit }).events;
}

export function subscribeActivity(listener: (event: ActivityEvent) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
