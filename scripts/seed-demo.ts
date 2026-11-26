import { Geometry } from '@svaltek/substratum';
import type { Vec3 } from '@svaltek/substratum';

const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:4383');
if (origin.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname)) {
    throw new Error('The demo seeder requires a local HTTP server.');
}
const token = process.env.MANAGEMENT_TOKEN;
if (!token) throw new Error('Set MANAGEMENT_TOKEN before seeding a demo.');

async function api<T>(path: string, body?: object): Promise<T> {
    const response = await fetch(new URL(`/api/v1/${path}`, origin), {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Demo request ${path} failed with HTTP ${response.status}.`);
    return await response.json() as T;
}

const initial = await api<{ bits: number; cells: number; contents: number }>('stats');
if (initial.cells || initial.contents) throw new Error('Demo seeding requires an empty world.');
if (initial.bits < 10) throw new Error('The demo world requires at least 10 coordinate bits.');
const geometry = new Geometry(initial.bits);
const sites = [
    { name: 'West ridge', position: [-85, 4, -40] },
    { name: 'East staging', position: [48, 0, 64] },
    { name: 'North crossing', position: [70, 7, -72] },
] as const;
const kinds = ['observation', 'resource', 'survey-marker', 'inspection'] as const;
let seed = 6803;
function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
}

for (const site of sites) {
    const [x, y, z] = site.position;
    for (let i = 0; i < 24; i++) {
        const offset = () => Math.round((random() - random()) * 45);
        const point: Vec3 = [x + offset(), y + Math.round(random() * 8), z + offset()];
        const kind = kinds[i % kinds.length]!;
        await api('contents', {
            kind, payload: { label: `${site.name} ${kind} ${i + 1}`, position: point },
            address: geometry.point(point), metadata: { tags: ['fieldwork'], site: site.name, verified: i % 3 !== 0 },
        });
    }
    const region = geometry.cover({ at: [x, y, z], extent: [12, 4, 12] });
    await api('contents', {
        kind: 'survey-region', payload: { name: site.name, bounds: geometry.bounds(region) },
        address: region, metadata: { tags: ['survey'], site: site.name },
    });
}

const relay = await api<{ id: string }>('contents', {
    kind: 'relay', payload: { name: 'Survey relay network', purpose: 'Link separated field stations' },
});
for (const site of sites) {
    const [x, y, z] = site.position;
    await api('placements', {
        id: relay.id, address: geometry.cover({ at: [x, y, z], extent: [1, 12, 1] }),
        metadata: { tags: ['shared', 'relay'], site: site.name },
    });
}
await api('contents', { kind: 'observation', payload: { label: 'Unplaced survey report', status: 'awaiting location' } });
await api('events', { name: 'survey:demo-ready', data: { stations: sites.length } });
await api('search', { kind: 'relay', tags: ['shared'], unique: false, limit: 50 });
const stats = await api<{ cells: number; attachments: number; contents: number; orphans: number }>('stats');
console.log(`Seeded ${stats.cells} cells, ${stats.attachments} attachments, ${stats.contents} content records and ${stats.orphans} orphans.`);
