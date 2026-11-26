import type { Address } from '@svaltek/substratum';
import type { RuntimeService } from './runtime';

function pageOptions(params: URLSearchParams) {
    const page = Number(params.get('page') ?? 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100_000_000) throw new RangeError('Invalid page.');
    const limit = 30;
    return { page, limit, offset: (page - 1) * limit };
}

export function contentPage(server: RuntimeService, params: URLSearchParams) {
    const { page, limit, offset } = pageOptions(params);
    const search = (params.get('q') ?? '').trim().slice(0, 256);
    const kind = (params.get('kind') ?? '').slice(0, 256);
    const orphans = Number(params.get('orphans') === 'true');
    const filter = `
        WHERE (?1 = '' OR instr(lower(c.id), lower(?1)) > 0 OR instr(lower(c.kind), lower(?1)) > 0)
          AND (?2 = '' OR c.kind = ?2)
          AND (?3 = 0 OR NOT EXISTS (SELECT 1 FROM attachments WHERE content_id = c.id))
    `;
    const { total } = server.db.query<{ total: number }, [string, string, number]>(
        `SELECT COUNT(*) AS total FROM contents c ${filter}`,
    ).get(search, kind, orphans)!;
    const items = server.db.query<{ id: string; kind: string; placements: number }, [string, string, number, number, number]>(`
        SELECT c.id, c.kind, (SELECT COUNT(*) FROM attachments WHERE content_id = c.id) AS placements
        FROM contents c ${filter} ORDER BY c.id LIMIT ?4 OFFSET ?5
    `).all(search, kind, orphans, limit, offset);
    return { page, limit, total, items };
}

export function cellPage(server: RuntimeService, params: URLSearchParams) {
    const { page, limit, offset } = pageOptions(params);
    const { total } = server.db.query<{ total: number }, []>('SELECT COUNT(*) AS total FROM cells').get()!;
    const rows = server.db.query<{ address: string; attachments: number }, [number, number]>(`
        SELECT c.address_json AS address,
            (SELECT COUNT(*) FROM attachments WHERE address_key = c.address_key) AS attachments
        FROM cells c ORDER BY c.address_key LIMIT ? OFFSET ?
    `).all(limit, offset);
    return { page, limit, total, items: rows.map(row => ({ ...row, address: JSON.parse(row.address) as Address })) };
}
