<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStore } from '@nanostores/vue';
import type { Bounds } from '@svaltek/substratum';
import {
    atlasClusterSize, atlasMetadata, atlasScope, atlasShowLinks, atlasShowMetaOnly,
    atlasShowPoints, atlasShowRegions, atlasSnapshot, atlasVisibleRadius,
    selectedKind, selectedTag,
} from '../../lib/dashboard-state';
import { colorForKind } from '../../lib/atlas/map-renderer';
import { dashboardRequest } from '../../lib/dashboard-api';
import AddressBuilder from '../ui/AddressBuilder.vue';
import type { RegionMode } from '../workspace/RegionFields.vue';

defineEmits<{ fit: [] }>();
const snapshot = useStore(atlasSnapshot);
const kind = useStore(selectedKind);
const tag = useStore(selectedTag);
const showPoints = useStore(atlasShowPoints);
const showRegions = useStore(atlasShowRegions);
const showMetaOnly = useStore(atlasShowMetaOnly);
const showLinks = useStore(atlasShowLinks);
const clusterSize = useStore(atlasClusterSize);
const visibleRadius = useStore(atlasVisibleRadius);
const kinds = computed(() => [...new Set((snapshot.value?.contents ?? []).map(item => item.kind))].sort());
const scope = useStore(atlasScope);
const metadataInput = ref('{}');
const regionMode = ref<RegionMode>('all');
const regionInput = ref('');
const overlap = ref(true);
const error = ref('');

async function applyScope() {
    error.value = '';
    try {
        const metadata = JSON.parse(metadataInput.value);
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new TypeError('Metadata filter must be a JSON object.');
        const bounds = regionMode.value !== 'all' && regionInput.value.trim()
            ? (await dashboardRequest<{ bounds: Bounds }>('/api/v1/geometry', {
                method: 'POST', body: JSON.stringify({ region: JSON.parse(regionInput.value) }),
            })).bounds
            : null;
        atlasMetadata.set(metadata);
        atlasScope.set(bounds ? { bounds, overlap: overlap.value } : null);
    } catch (cause) { error.value = (cause as Error).message; }
}

function clearScope() {
    regionMode.value = 'all';
    regionInput.value = '';
    metadataInput.value = '{}';
    atlasMetadata.set({});
    atlasScope.set(null);
    error.value = '';
}
</script>

<template>
  <aside class="panel controls">
    <div class="panel-heading"><span>View filters</span><button class="text-button" @click="$emit('fit')">Fit all</button></div>

    <label>Content kind
      <select :value="kind" @change="selectedKind.set(($event.currentTarget as HTMLSelectElement).value)">
        <option value="">All kinds</option>
        <option v-for="value in kinds" :key="value" :value="value">{{ value }}</option>
      </select>
    </label>

    <label>Exact tag
      <input :value="tag" placeholder="e.g. shared" @input="selectedTag.set(($event.currentTarget as HTMLInputElement).value)">
    </label>

    <div class="atlas-toggles">
      <label class="atlas-check"><input type="checkbox" :checked="showPoints" @change="atlasShowPoints.set(($event.target as HTMLInputElement).checked)" /> Point cells</label>
      <label class="atlas-check"><input type="checkbox" :checked="showRegions" @change="atlasShowRegions.set(($event.target as HTMLInputElement).checked)" /> Region extents</label>
      <label class="atlas-check"><input type="checkbox" :checked="showMetaOnly" @change="atlasShowMetaOnly.set(($event.target as HTMLInputElement).checked)" /> Metadata-only cells</label>
      <label class="atlas-check"><input type="checkbox" :checked="showLinks" @change="atlasShowLinks.set(($event.target as HTMLInputElement).checked)" /> Identity links</label>
    </div>

    <label>Cluster size ({{ clusterSize }} px)
      <input type="range" min="8" max="40" :value="clusterSize" @input="atlasClusterSize.set(Number(($event.target as HTMLInputElement).value))" />
    </label>

    <label>Visible radius
      <select :value="visibleRadius" @change="atlasVisibleRadius.set(Number(($event.currentTarget as HTMLSelectElement).value))">
        <option :value="0">All space</option>
        <option :value="64">64 units</option>
        <option :value="128">128 units</option>
        <option :value="256">256 units</option>
        <option :value="512">512 units</option>
        <option :value="1024">1024 units</option>
      </select>
    </label>

    <form class="scope-form" @submit.prevent="applyScope">
      <div class="legend-title">QUERY SCOPE</div>
      <AddressBuilder v-model:mode="regionMode" v-model="regionInput" allow-all />
      <label>Attachment metadata JSON <input v-model="metadataInput" class="monospace" spellcheck="false" /></label>
      <label class="atlas-check"><input v-model="overlap" type="checkbox" /> Include overlaps</label>
      <div class="scope-actions">
        <button class="quiet" type="submit">Apply scope</button>
        <button v-if="scope" class="quiet" type="button" @click="clearScope">Reset</button>
      </div>
      <p v-if="error" class="atlas-help err" role="alert">{{ error }}</p>
    </form>

    <div class="legend-title">KIND KEY</div>
    <div class="legend">
      <span v-for="value in kinds" :key="value"><i :style="{ backgroundColor: colorForKind(value) }"></i>{{ value }}</span>
      <span><i class="empty-dot"></i>Metadata only</span>
    </div>
  </aside>
</template>

<style scoped>
.atlas-toggles { display: grid; gap: 4px; margin: 10px 0 14px; }
.panel .atlas-check { display: flex; align-items: center; gap: 6px; margin: 2px 0; cursor: pointer; }
.panel .atlas-check input { width: auto; margin: 0; }
.scope-form { display: grid; gap: 8px; border-top: 1px solid var(--border-subtle); padding-top: 6px; }
.scope-actions { display: flex; gap: 6px; }
.atlas-help { font-size: 11px; color: var(--text-secondary); margin: 0; }
.atlas-help.err { color: var(--danger); }
</style>
