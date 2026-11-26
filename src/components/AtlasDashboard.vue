<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import AtlasControls from './atlas/AtlasControls.vue';
import AtlasHeader from './atlas/AtlasHeader.vue';
import AtlasInspector from './atlas/AtlasInspector.vue';
import AtlasMap from './atlas/AtlasMap.vue';
import AtlasStats from './atlas/AtlasStats.vue';
import { fetchSnapshot, subscribeToChanges } from '../lib/atlas/api';
import { dashboardRequest } from '../lib/dashboard-api';
import { atlasConnection, atlasHighlighted, atlasMarkedRegions, atlasSnapshot, selectedAddress, selectedContentId, addressKey } from '../lib/dashboard-state';
import type { AtlasDelta, RuntimeChange, Snapshot } from '../lib/atlas/types';

const notice = ref('Starting the live view…');
const fitRevision = ref(0);
let unsubscribe: (() => void) | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let streamReady = false;
let refreshAll = true;
let refreshing = false;
let mounted = false;
const changedCells = new Map<string, RuntimeChange['regions'][number]>();
const changedContents = new Set<string>();

function replaceSnapshot(snapshot: Snapshot) {
    atlasSnapshot.set(snapshot);
    const id = selectedAddress.get();
    if (id && !snapshot.cells.some(cell => addressKey(cell.address) === id)) selectedAddress.set(null);
}

async function refreshSnapshot() {
    if (refreshing) return;
    const full = refreshAll || !atlasSnapshot.get() || changedCells.size + changedContents.size > 256;
    const addresses = [...changedCells.values()];
    const contentIds = [...changedContents];
    if (!full && !addresses.length && !contentIds.length) return;
    refreshAll = false;
    changedCells.clear();
    changedContents.clear();
    refreshing = true;
    try {
        const snapshot = atlasSnapshot.get();
        if (full || !snapshot) {
            const loaded = await fetchSnapshot();
            if (!mounted) return;
            replaceSnapshot(loaded);
        } else {
            const delta = await dashboardRequest<AtlasDelta>('/api/v1/atlas/delta', {
                method: 'POST', body: JSON.stringify({ addresses, contentIds }),
            });
            if (!mounted) return;
            const cells = new Map(snapshot.cells.map(cell => [addressKey(cell.address), cell]));
            const contents = new Map(snapshot.contents.map(content => [content.id, content]));
            for (const cell of addresses) cells.delete(addressKey(cell));
            for (const id of contentIds) contents.delete(id);
            for (const cell of delta.cells) cells.set(addressKey(cell.address), cell);
            for (const content of delta.contents) contents.set(content.id, content);
            replaceSnapshot({ ...snapshot, cells: [...cells.values()], contents: [...contents.values()] });
        }
        atlasConnection.set(streamReady ? 'live' : 'offline');
        notice.value = streamReady ? 'Receiving server changes' : 'Waiting for the event stream…';
    } catch (error) {
        refreshAll = true;
        atlasConnection.set('offline');
        notice.value = error instanceof Error ? error.message : 'Unable to load live data.';
    } finally {
        refreshing = false;
        if (mounted && (refreshAll || changedCells.size || changedContents.size)) {
            scheduleRefresh(refreshAll && atlasConnection.get() === 'offline' ? 2000 : 120);
        }
    }
}

function scheduleRefresh(delay = 120) {
    if (refreshTimer || refreshing) return;
    refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void refreshSnapshot();
    }, delay);
}

function requestSnapshot() {
    refreshAll = true;
    scheduleRefresh();
}

onMounted(() => {
    mounted = true;
    const params = new URLSearchParams(location.search);
    selectedContentId.set(params.get('content'));
    try {
        if (params.has('address')) {
            const address = JSON.parse(params.get('address')!);
            if (Array.isArray(address) && address.length === 3) selectedAddress.set(addressKey(address));
        }
        if (params.has('query')) {
            const addresses = JSON.parse(sessionStorage.getItem('substratum.atlas-query') ?? '[]');
            atlasHighlighted.set(new Set(addresses.map(addressKey)));
            if (!selectedAddress.get() && addresses.length) selectedAddress.set(addressKey(addresses[0]));
        }
        if (params.has('regions')) {
            const addresses = JSON.parse(sessionStorage.getItem('substratum.atlas-regions') ?? '[]');
            if (Array.isArray(addresses)) {
                atlasMarkedRegions.set(addresses.slice(0, 256).filter(address =>
                    Array.isArray(address) && address.length === 3 && address.every(part => typeof part === 'string' && /^[01]{0,32}$/.test(part)),
                ));
                atlasHighlighted.set(new Set(atlasMarkedRegions.get().map(addressKey)));
            }
        }
    } catch { /* Invalid standalone links can still open the map. */ }
    unsubscribe = subscribeToChanges(event => {
        const change: RuntimeChange = JSON.parse(event.data);
        if (change.reset) refreshAll = true;
        for (const address of change.regions) changedCells.set(addressKey(address), address);
        for (const id of change.contentIds) changedContents.add(id);
        scheduleRefresh();
    }, () => {
        streamReady = false;
        atlasConnection.set('offline');
        notice.value = 'Reconnecting to the event stream…';
    }, () => {
        streamReady = true;
        requestSnapshot();
    });
    scheduleRefresh();
});

onUnmounted(() => {
    mounted = false;
    unsubscribe?.();
    if (refreshTimer) clearTimeout(refreshTimer);
});
</script>

<template>
  <div class="atlas-shell">
    <AtlasHeader :notice="notice" @refresh="requestSnapshot" />
    <AtlasStats />
    <main class="workspace">
      <AtlasControls @fit="fitRevision++" />
      <AtlasMap :fit-revision="fitRevision" />
      <AtlasInspector />
    </main>
  </div>
</template>
