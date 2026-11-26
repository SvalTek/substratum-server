import { Geometry } from '@svaltek/substratum';
import type { Address, Bounds, Vec3 } from '@svaltek/substratum';
import type { Snapshot } from './types';
import { addressKey } from '../dashboard-state';

export interface MapView {
    zoom: number;
    panX: number;
    panY: number;
    camX: number;
    camY: number;
    camZ: number;
    yaw: number;
    pitch: number;
    projection: 'fly' | 'orbit' | 'top';
}

export interface DrawTarget {
    x: number;
    y: number;
    radius: number;
    addresses: Address[];
    count: number;
}

export interface DrawResult {
    targets: DrawTarget[];
    rendered: number;
    clusters: number;
    center: Vec3;
    span: number;
}

export interface AtlasNode {
    address: Address;
    key: string;
    bounds: Bounds;
    center: Vec3;
    point: boolean;
    color: string;
    shared: boolean;
    overlay?: boolean;
}

type Coordinate = readonly [number, number, number];
const colors = ['#86b4ff', '#8ce0cc', '#a99aff', '#f4c474', '#e28aa6', '#7ed2ed'];
const edges = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]] as const;
const renderBudget = 24000;
const boxBudget = 1600;

export function colorForKind(kind: string): string {
    if (!kind) return '#8d9ab2';
    let hash = 0;
    for (const letter of kind) hash = (Math.imul(31, hash) + letter.codePointAt(0)!) >>> 0;
    return colors[hash % colors.length]!;
}

function matchingValue(actual: unknown, expected: unknown): boolean {
    if (actual === expected) return true;
    if (expected === null || actual === null || typeof actual !== 'object' || typeof expected !== 'object') return false;
    if (Array.isArray(actual) !== Array.isArray(expected)) return false;
    const left = actual as Record<string, unknown>;
    const right = expected as Record<string, unknown>;
    const keys = Object.keys(right);
    return Object.keys(left).length === keys.length && keys.every(key => Object.hasOwn(left, key) && matchingValue(left[key], right[key]));
}

export function atlasNodes(
    snapshot: Snapshot | null,
    filters: {
        kind: string;
        tag: string;
        metadata: Record<string, unknown>;
        scope: { bounds: Bounds; overlap: boolean } | null;
        slice: number | null;
        selectedContent: string | null;
        mode: 'all' | 'points' | 'boxes' | 'columns';
        markedRegions: readonly Address[];
        showPoints: boolean;
        showRegions: boolean;
        showMetaOnly: boolean;
        visibleRadius: number;
        cameraCenter: Vec3;
    },
): AtlasNode[] {
    if (!snapshot) return [];
    const geometry = new Geometry(snapshot.bits);
    const contentById = new Map(snapshot.contents.map(content => [content.id, content.kind]));
    const metadata = Object.entries(filters.metadata);
    const hasFilter = Boolean(filters.kind || filters.tag || metadata.length);
    const result: AtlasNode[] = [];
    const r2 = filters.visibleRadius > 0 ? filters.visibleRadius * filters.visibleRadius : 0;

    for (const cell of snapshot.cells) {
        if (!filters.showMetaOnly && !cell.attachments.length) continue;
        const key = addressKey(cell.address);
        const match = cell.attachments.find(attachment =>
            (!filters.kind || contentById.get(attachment.id) === filters.kind) &&
            (!filters.tag || (Array.isArray(attachment.metadata.tags) && attachment.metadata.tags.includes(filters.tag))) &&
            metadata.every(([name, value]) => matchingValue(attachment.metadata[name], value)),
        );
        if (hasFilter && !match) continue;
        const originalBounds = geometry.bounds(cell.address);
        const scope = filters.scope;
        if (scope && !originalBounds.every(([lo, hi], axis) => {
            const [start, end] = scope.bounds[axis]!;
            return scope.overlap ? lo <= end && hi >= start : lo >= start && hi <= end;
        })) continue;
        const slice = filters.slice;
        if (slice !== null && (slice < originalBounds[1][0] || slice > originalBounds[1][1])) continue;
        const bounds: Bounds = slice === null ? originalBounds : [originalBounds[0], [slice, slice], originalBounds[2]];
        const point = originalBounds.every(([minimum, maximum]) => minimum === maximum);
        const column = !point && originalBounds[0][0] === originalBounds[0][1] && originalBounds[2][0] === originalBounds[2][1];
        if (!filters.showPoints && point) continue;
        if (!filters.showRegions && !point) continue;
        if ((filters.mode === 'points' && !point) || (filters.mode === 'boxes' && (point || column)) ||
            (filters.mode === 'columns' && !column)) continue;
        const [[x0, x1], [y0, y1], [z0, z1]] = bounds;
        const center: Vec3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
        if (r2 > 0) {
            const dx = center[0] - filters.cameraCenter[0];
            const dy = center[1] - filters.cameraCenter[1];
            const dz = center[2] - filters.cameraCenter[2];
            if (dx * dx + dy * dy + dz * dz > r2) continue;
        }
        const firstAttachment = match ?? cell.attachments[0];
        result.push({
            address: cell.address,
            key,
            bounds,
            center,
            point,
            color: colorForKind(firstAttachment ? contentById.get(firstAttachment.id) ?? '' : ''),
            shared: filters.selectedContent !== null && cell.attachments.some(item => item.id === filters.selectedContent),
        });
    }
    if (filters.markedRegions.length) {
        const existing = new Set(result.map(node => node.key));
        for (const address of filters.markedRegions) {
            const key = addressKey(address);
            if (existing.has(key) || address.some(prefix => prefix.length > snapshot.bits)) continue;
            const bounds = geometry.bounds(address);
            const [[x0, x1], [y0, y1], [z0, z1]] = bounds;
            result.push({
                address,
                key,
                bounds,
                center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
                point: x0 === x1 && y0 === y1 && z0 === z1,
                color: '#c4b6ff',
                shared: false,
                overlay: true,
            });
            existing.add(key);
        }
    }
    return result;
}

export function frameBounds(nodes: readonly AtlasNode[], selected: string | null) {
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    const selectedNode = selected ? nodes.find(node => node.key === selected) : undefined;
    if (selectedNode) {
        lo = selectedNode.bounds.map(bound => bound[0]);
        hi = selectedNode.bounds.map(bound => bound[1]);
    } else {
        for (const { bounds } of nodes) {
            for (const axis of [0, 1, 2] as const) {
                lo[axis] = Math.min(lo[axis]!, bounds[axis][0]);
                hi[axis] = Math.max(hi[axis]!, bounds[axis][1]);
            }
        }
    }
    return {
        center: [
            (lo[0]! + hi[0]!) / 2,
            (lo[1]! + hi[1]!) / 2,
            (lo[2]! + hi[2]!) / 2,
        ] as Vec3,
        span: Math.max(12, ...hi.map((maximum, i) => maximum - lo[i]! + 1)),
    };
}

export function drawSpatialMap(
    canvas: HTMLCanvasElement,
    nodes: readonly AtlasNode[],
    selected: string | null,
    highlighted: ReadonlySet<string>,
    view: MapView,
    focus: string | null,
    clustering: boolean,
    clusterSize: number,
    showLinks: boolean,
): DrawResult {
    const { width, height } = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.floor(width * dpr));
    const pixelHeight = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { targets: [], rendered: 0, clusters: 0, center: [0, 0, 0], span: 12 };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#070b13';
    ctx.fillRect(0, 0, width, height);
    if (!nodes.length) return { targets: [], rendered: 0, clusters: 0, center: [0, 0, 0], span: 12 };

    const { center, span } = frameBounds(nodes, focus);
    const cx = view.projection === 'fly' ? view.camX : center[0];
    const cy = view.projection === 'fly' ? view.camY : center[1];
    const cz = view.projection === 'fly' ? view.camZ : center[2];
    const scale = Math.max(1, Math.min(width - 42, height - 42)) / span * 0.68 * view.zoom;
    const yaw = view.projection === 'top' ? 0 : view.yaw;
    const pitch = view.projection === 'top' ? Math.PI / 2 : view.pitch;
    const sy = Math.sin(yaw); const cyaw = Math.cos(yaw);
    const sp = Math.sin(pitch); const cp = Math.cos(pitch);

    function project([x, y, z]: Vec3): Coordinate {
        const dx = x - cx;
        const dy = y - cy;
        const dz = z - cz;
        const lateral = dx * cyaw - dz * sy;
        const inward = dx * sy + dz * cyaw;
        const depth = inward * cp + dy * sp;
        const cameraDistance = span * 2.25;
        const perspective = view.projection === 'top' ? 1 : cameraDistance / Math.max(cameraDistance * 0.25, cameraDistance + depth);
        return [
            width / 2 + lateral * scale * perspective + view.panX,
            height / 2 + (inward * sp - dy * cp) * scale * perspective + view.panY,
            depth,
        ];
    }
    function segment(a: Coordinate, b: Coordinate) {
        ctx!.moveTo(a[0], a[1]);
        ctx!.lineTo(b[0], b[1]);
    }

    const step = 2 ** Math.ceil(Math.log2(span / 8));
    const originX = Math.round(cx / step) * step;
    const originZ = Math.round(cz / step) * step;
    const reach = step * 10;
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#192236';
    ctx.beginPath();
    for (let i = -10; i <= 10; i++) {
        const offset = i * step;
        segment(project([originX + offset, cy, originZ - reach]), project([originX + offset, cy, originZ + reach]));
        segment(project([originX - reach, cy, originZ + offset]), project([originX + reach, cy, originZ + offset]));
    }
    ctx.stroke();

    const groups = new Map<string, DrawTarget & { color: string }>();
    const targets: DrawTarget[] = [];
    const connections: Coordinate[] = [];
    const stride = Math.max(1, Math.ceil(nodes.length / renderBudget));
    let boxes = 0;
    let rendered = 0;
    for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index]!;
        const selectedNode = node.key === selected;
        const highlightedNode = highlighted.has(node.key);
        const priority = selectedNode || highlightedNode || (node.shared && connections.length < 256);
        if (!priority && index % stride !== 0) continue;
        const position = project(node.center);
        const [x, y] = position;
        if (node.shared && connections.length < 256) connections.push(position);
        const color = selectedNode ? '#fff' : highlightedNode ? '#c4b6ff' : node.color;
        if (node.point) {
            if (x < -18 || x > width + 18 || y < -18 || y > height + 18) continue;
            rendered++;
            const key = clustering && !priority ? `${Math.floor(x / clusterSize)}:${Math.floor(y / clusterSize)}` : node.key;
            const group = groups.get(key);
            if (group) {
                group.count++;
                if (group.addresses.length < 24) group.addresses.push(node.address);
            } else groups.set(key, { x, y, color, radius: priority ? 7 : 4, count: 1, addresses: node.overlay ? [] : [node.address] });
        } else if (boxes < boxBudget || priority) {
            const [[x0, x1], [y0, y1], [z0, z1]] = node.bounds;
            const corners: Coordinate[] = [];
            for (const vx of [x0 - 0.5, x1 + 0.5]) for (const vy of [y0 - 0.5, y1 + 0.5]) for (const vz of [z0 - 0.5, z1 + 0.5]) {
                corners.push(project([vx, vy, vz]));
            }
            if (corners.every(p => p[0] < 0) || corners.every(p => p[0] > width) ||
                corners.every(p => p[1] < 0) || corners.every(p => p[1] > height)) continue;
            boxes++;
            rendered++;
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = priority ? 1.8 : 1;
            ctx.globalAlpha = priority ? 0.95 : 0.44;
            for (const [a, b] of edges) segment(corners[a]!, corners[b]!);
            ctx.stroke();
            ctx.globalAlpha = 1;
            if (!node.overlay) targets.push({ x, y, radius: 9, count: 1, addresses: [node.address] });
        }
    }
    if (showLinks && connections.length > 1) {
        const anchor = connections[0]!;
        ctx.strokeStyle = '#a99aff';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        for (const connected of connections.slice(1)) segment(anchor, connected);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    let clusters = 0;
    for (const group of groups.values()) {
        if (group.count > 1) clusters++;
        const radius = Math.min(16, group.radius + (group.count > 1 ? Math.sqrt(group.count) : 0));
        ctx.fillStyle = group.color;
        ctx.beginPath();
        ctx.arc(group.x, group.y, radius, 0, Math.PI * 2);
        ctx.fill();
        if (group.count > 1) {
            ctx.fillStyle = '#070b13';
            ctx.font = '600 10px ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(group.count > 99 ? '99+' : String(group.count), group.x, group.y + 0.5);
        }
        if (group.addresses.length) targets.push({ x: group.x, y: group.y, radius, count: group.count, addresses: group.addresses });
    }
    return { targets, rendered, clusters, center: [cx, cy, cz], span };
}
