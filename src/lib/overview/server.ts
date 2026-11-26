import { uptime } from 'node:process';
import { version } from '../../../package.json';
import type { RuntimeService } from '../runtime';
import type { OverviewStats } from './types';
import { metrics } from '../metrics';
import { activitySnapshot } from '../activity/journal';

type OverviewMetrics = Pick<OverviewStats, 'clientCount' | 'performance' | 'recent' | 'pluginSummary'>;

export function overviewMetrics(server: RuntimeService): OverviewMetrics {
    const { db } = server;
    const { recentEvents, queries, mutations, throughputSeries } = metrics();
    const { clientCount } = db.query<{ clientCount: number }, []>('SELECT COUNT(*) AS clientCount FROM clients').get()!;
    const recent = activitySnapshot(8).map(({ id, time, name, category, kind }) => ({ id, time, name, category, kind }));
    const statuses = server.pluginStatus();
    const pluginSummary = {
        total: statuses.length,
        active: statuses.filter(p => p.status === 'active').length,
        errored: statuses.filter(p => p.status === 'error').length,
    };
    return {
        clientCount,
        pluginSummary,
        performance: { recentEvents, queryP95: queries.p95, mutationP95: mutations.p95, throughputSeries },
        recent,
    };
}

export function overviewStats(server: RuntimeService): Pick<OverviewStats, 'version' | 'uptimeSeconds' | 'storage' | 'kinds'> & OverviewMetrics {
    const { db } = server;
    const kinds = db.query<{ kind: string; count: number }, []>(`
        SELECT kind, COUNT(*) AS count FROM contents
        GROUP BY kind ORDER BY count DESC, kind LIMIT 8
    `).all();
    const storageRow = db.query<{ journal: string; allocatedBytes: number }, []>(`
        SELECT journal_mode AS journal, page_count * page_size AS allocatedBytes
        FROM pragma_journal_mode(), pragma_page_count(), pragma_page_size()
    `).get()!;
    const { backupCount } = db.query<{ backupCount: number }, []>('SELECT COUNT(*) AS backupCount FROM backups').get()!;

    return {
        version,
        uptimeSeconds: Math.floor(uptime()),
        storage: { ...storageRow, backupCount },
        kinds,
        ...overviewMetrics(server),
    };
}
