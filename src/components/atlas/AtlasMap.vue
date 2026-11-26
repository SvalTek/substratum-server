<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useStore } from '@nanostores/vue';
import type { Address, Vec3 } from '@svaltek/substratum';
import {
    atlasClusterSize, atlasHighlighted, atlasMarkedRegions, atlasMetadata, atlasScope,
    atlasShowLinks, atlasShowMetaOnly, atlasShowPoints, atlasShowRegions, atlasSnapshot,
    atlasVisibleRadius, selectedAddress, selectedContentId, selectedKind, selectedTag,
} from '../../lib/dashboard-state';
import { atlasNodes, drawSpatialMap, frameBounds, type DrawTarget, type MapView } from '../../lib/atlas/map-renderer';
import { formatAddress } from '../../lib/workspace-types';

const props = defineProps<{ fitRevision: number }>();
const snapshot = useStore(atlasSnapshot);
const kind = useStore(selectedKind);
const tag = useStore(selectedTag);
const selected = useStore(selectedAddress);
const content = useStore(selectedContentId);
const highlighted = useStore(atlasHighlighted);
const markedRegions = useStore(atlasMarkedRegions);
const metadata = useStore(atlasMetadata);
const scope = useStore(atlasScope);
const showPoints = useStore(atlasShowPoints);
const showRegions = useStore(atlasShowRegions);
const showMetaOnly = useStore(atlasShowMetaOnly);
const showLinks = useStore(atlasShowLinks);
const clusterSize = useStore(atlasClusterSize);
const visibleRadius = useStore(atlasVisibleRadius);

const canvas = ref<HTMLCanvasElement>();
const view = reactive<MapView>({
    zoom: 1, panX: 0, panY: 0, camX: 0, camY: 0, camZ: 0,
    yaw: 0.55, pitch: 0.52, projection: 'orbit',
});
const focus = ref<string | null>(null);
const mode = ref<'all' | 'points' | 'boxes' | 'columns'>('all');
const sliceOn = ref(false);
const slice = ref(0);
const clustering = ref(true);
const cluster = ref<DrawTarget | null>(null);
const hud = reactive({ rendered: 0, total: 0, clusters: 0, cam: [0, 0, 0] as Vec3 });

const nodes = computed(() => atlasNodes(snapshot.value, {
    kind: kind.value,
    tag: tag.value,
    metadata: metadata.value,
    scope: scope.value,
    selectedContent: content.value,
    mode: mode.value,
    slice: sliceOn.value ? Number(slice.value) : null,
    markedRegions: markedRegions.value,
    showPoints: showPoints.value,
    showRegions: showRegions.value,
    showMetaOnly: showMetaOnly.value,
    visibleRadius: visibleRadius.value,
    cameraCenter: [view.camX, view.camY, view.camZ],
}));

let observer: ResizeObserver | undefined;
let frame = 0;
let drag: { x: number; y: number; panX: number; panY: number; yaw: number; pitch: number; pan: boolean } | undefined;
let targets: DrawTarget[] = [];

function redraw() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
        if (!canvas.value) return;
        const result = drawSpatialMap(
            canvas.value, nodes.value, selected.value, highlighted.value,
            view, focus.value, clustering.value, clusterSize.value, showLinks.value,
        );
        targets = result.targets;
        hud.rendered = result.rendered;
        hud.total = nodes.value.length;
        hud.clusters = result.clusters;
        hud.cam = result.center;
    });
}

function fit(address: string | null = null) {
    focus.value = address;
    const framed = frameBounds(nodes.value, address);
    view.camX = framed.center[0];
    view.camY = framed.center[1];
    view.camZ = framed.center[2];
    view.zoom = 1;
    view.panX = 0;
    view.panY = 0;
    cluster.value = null;
    redraw();
}

function setProjection(projection: MapView['projection']) {
    if (projection === 'fly' && view.projection !== 'fly') {
        const framed = frameBounds(nodes.value, focus.value);
        view.camX = framed.center[0];
        view.camY = framed.center[1];
        view.camZ = framed.center[2];
        view.panX = 0;
        view.panY = 0;
    }
    view.projection = projection;
    redraw();
}

function pointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    canvas.value?.focus({ preventScroll: true });
    canvas.value?.setPointerCapture(event.pointerId);
    drag = {
        x: event.clientX, y: event.clientY,
        panX: view.panX, panY: view.panY,
        yaw: view.yaw, pitch: view.pitch,
        pan: event.shiftKey || view.projection === 'top',
    };
}

function pointerMove(event: PointerEvent) {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) <= 4) return;
    if (drag.pan && view.projection !== 'fly') {
        view.panX = drag.panX + dx;
        view.panY = drag.panY + dy;
    } else {
        view.yaw = drag.yaw + dx * 0.009;
        view.pitch = Math.min(1.54, Math.max(-1.4, drag.pitch + dy * 0.008));
    }
    redraw();
}

function pointerUp(event: PointerEvent) {
    if (!drag) return;
    const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4;
    drag = undefined;
    if (moved) return;
    const bounds = canvas.value?.getBoundingClientRect();
    if (!bounds) return;
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const target = targets.filter(item => Math.hypot(item.x - x, item.y - y) <= item.radius + 4)
        .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    cluster.value = target && target.count > 1 ? target : null;
    if (target && !cluster.value) select(target.addresses[0]!);
}

function select(address: Address) {
    selectedAddress.set(address.join('/'));
    selectedContentId.set(null);
    cluster.value = null;
}

function clearHighlights() {
    atlasHighlighted.set(new Set());
    atlasMarkedRegions.set([]);
}

function zoom(multiplier: number) {
    view.zoom = Math.min(512, Math.max(0.1, view.zoom * multiplier));
    cluster.value = null;
}

function wheel(event: WheelEvent) {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 1.15 : 0.87);
}

function moveStep(key: string, boost = false) {
    const speed = boost ? 28 : 10;
    const panSpeed = boost ? 65 : 24;
    if (view.projection === 'fly') {
        const sy = Math.sin(view.yaw);
        const cy = Math.cos(view.yaw);
        switch (key) {
            case 'w': view.camX += sy * speed; view.camZ += cy * speed; break;
            case 's': view.camX -= sy * speed; view.camZ -= cy * speed; break;
            case 'a': view.camX -= cy * speed; view.camZ += sy * speed; break;
            case 'd': view.camX += cy * speed; view.camZ -= sy * speed; break;
            case 'q': view.camY -= speed; break;
            case 'e': view.camY += speed; break;
            default: return false;
        }
    } else {
        switch (key) {
            case 'w': case 'arrowup': view.panY += panSpeed; break;
            case 's': case 'arrowdown': view.panY -= panSpeed; break;
            case 'a': case 'arrowleft': view.panX += panSpeed; break;
            case 'd': case 'arrowright': view.panX -= panSpeed; break;
            case 'q': zoom(0.87); break;
            case 'e': zoom(1.15); break;
            default: return false;
        }
    }
    cluster.value = null;
    return true;
}

function keydown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (moveStep(event.key.toLowerCase(), event.shiftKey)) event.preventDefault();
}

watch([nodes, selected, highlighted, clustering, clusterSize, showLinks, view], redraw);
watch(() => props.fitRevision, () => fit());
onMounted(() => { observer = new ResizeObserver(redraw); if (canvas.value) observer.observe(canvas.value); redraw(); });
onUnmounted(() => { observer?.disconnect(); if (frame) cancelAnimationFrame(frame); });
</script>

<template>
  <section class="viewport">
    <canvas ref="canvas" tabindex="0" aria-label="Interactive spatial map" @keydown="keydown" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="drag = undefined" @wheel="wheel"></canvas>
    <div v-if="!snapshot" class="map-loading">Loading live spatial data…</div>
    <div v-else-if="!nodes.length" class="map-loading">No cells match the current view.</div>

    <div class="map-toolbar" aria-label="Map display controls">
      <button class="quiet" :aria-pressed="view.projection === 'fly'" @click="setProjection('fly')">3D Fly</button>
      <button class="quiet" :aria-pressed="view.projection === 'orbit'" @click="setProjection('orbit')">Orbit</button>
      <button class="quiet" :aria-pressed="view.projection === 'top'" @click="setProjection('top')">Top</button>
      <select v-model="mode" class="quiet" aria-label="Cells to display">
        <option value="all">All cells</option>
        <option value="points">Points</option>
        <option value="boxes">Boxes</option>
        <option value="columns">Columns</option>
      </select>
      <label class="quiet"><input v-model="sliceOn" type="checkbox" /> Slice</label>
      <input v-if="sliceOn" v-model.number="slice" class="quiet map-slice" type="number" aria-label="Slice Y coordinate" />
      <label class="quiet"><input v-model="clustering" type="checkbox" /> Cluster</label>
      <button v-if="selected" class="quiet" @click="fit(selected)">Focus selection</button>
      <button v-if="highlighted.size" class="quiet" @click="clearHighlights">Clear highlights</button>
    </div>

    <div class="map-hud" aria-hidden="true">
      <div>MODE: {{ view.projection.toUpperCase() }} · ZOOM {{ view.zoom.toFixed(2) }}×</div>
      <div>CAM: [{{ Math.round(hud.cam[0]) }}, {{ Math.round(hud.cam[1]) }}, {{ Math.round(hud.cam[2]) }}]</div>
      <div>VISIBLE: {{ hud.rendered.toLocaleString() }} / {{ hud.total.toLocaleString() }} · CLUSTERS: {{ hud.clusters }}</div>
    </div>

    <div v-if="cluster" class="map-cluster">
      <strong>{{ cluster.count }} cells in cluster</strong>
      <button v-for="address in cluster.addresses" :key="formatAddress(address)" class="quiet" @click="select(address)">{{ formatAddress(address) }}</button>
    </div>

    <div class="map-help">
      <template v-if="view.projection === 'fly'">Drag to look <span>·</span> WASD fly <span>·</span> Q/E down/up <span>·</span> Shift boost <span>·</span> Scroll zoom</template>
      <template v-else>Drag to {{ view.projection === 'top' ? 'pan' : 'orbit' }} <span>·</span> Shift+drag / WASD to pan <span>·</span> Scroll to zoom</template>
    </div>

    <div class="map-nav" aria-label="Navigation pad">
      <button type="button" title="Down / Zoom out" @click="moveStep('q')">Q</button>
      <button type="button" title="Forward / Pan up" @click="moveStep('w')">W</button>
      <button type="button" title="Up / Zoom in" @click="moveStep('e')">E</button>
      <button type="button" title="Left" @click="moveStep('a')">A</button>
      <button type="button" title="Back / Pan down" @click="moveStep('s')">S</button>
      <button type="button" title="Right" @click="moveStep('d')">D</button>
    </div>

    <div class="map-actions">
      <button aria-label="Zoom in" @click="zoom(1.4)">+</button>
      <button aria-label="Zoom out" @click="zoom(1 / 1.4)">−</button>
    </div>
  </section>
</template>

<style scoped>
.map-toolbar { position: absolute; z-index: 2; inset: 10px 10px auto; display: flex; flex-wrap: wrap; gap: 5px; pointer-events: none; }
.map-toolbar > * { pointer-events: auto; }
.map-toolbar label { display: flex; align-items: center; gap: 5px; }
.map-toolbar [aria-pressed='true'] { background: var(--accent-soft); border-color: var(--accent); color: #f3edff; }
.map-slice { width: 75px; }
.map-hud {
  position: absolute;
  left: 12px;
  top: 52px;
  z-index: 1;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: rgba(11, 16, 27, 0.8);
  color: var(--text-secondary);
  font: 10px/1.6 var(--font-mono);
  pointer-events: none;
}
.map-cluster {
  position: absolute;
  z-index: 2;
  inset: 120px auto auto 12px;
  max-height: 45%;
  overflow: auto;
  display: grid;
  gap: 5px;
  padding: 8px;
  background: var(--bg-surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
}
.map-cluster strong { font-size: 12px; }
.map-nav {
  position: absolute;
  right: 52px;
  bottom: 12px;
  display: grid;
  grid-template-columns: repeat(3, 28px);
  gap: 4px;
}
.map-nav button {
  height: 28px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: rgba(15, 21, 35, 0.9);
  color: var(--text-secondary);
  font: 600 11px var(--font-mono);
}
.map-nav button:hover { border-color: var(--accent); color: var(--text-primary); }
canvas:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; }
.map-loading { position: absolute; left: 50%; top: 48%; transform: translateX(-50%); text-align: center; font-size: 13px; color: var(--text-secondary); pointer-events: none; }
</style>
