<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { ActivityEvent } from '../../lib/activity/types';
import { dashboardRequest } from '../../lib/dashboard-api';
import { formatAddress } from '../../lib/workspace-types';
import AddressBuilder from '../ui/AddressBuilder.vue';
import JsonEditor from '../ui/JsonEditor.vue';
import type { RegionMode } from '../workspace/RegionFields.vue';

const incoming = ref<ActivityEvent[]>([]);
const totalStored = ref(0);
const frozen = ref<ActivityEvent[] | null>(null);
const category = ref('');
const nameFilter = ref('');
const kindFilter = ref('');
const contentFilter = ref('');
const regionFilter = ref('');
const eventName = ref('');
const eventData = ref('{\n  "ok": true\n}');
const useRegion = ref(false);
const regionMode = ref<RegionMode>('address');
const eventRegion = ref('["", "", ""]');
const connection = ref('Connecting');
const error = ref('');
const notice = ref('');
const dates = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' });
let source: EventSource | undefined;
let revision = 0;
let retry: ReturnType<typeof setTimeout> | undefined;

const items = computed(() => (frozen.value ?? incoming.value).filter(event => {
    const prefixes = regionFilter.value.trim().split('/').map(part => part.trim() === '*' ? '' : part.trim());
    return (!category.value || event.category === category.value) &&
        (!nameFilter.value || event.name.toLowerCase().includes(nameFilter.value.toLowerCase())) &&
        (!kindFilter.value || event.kind === kindFilter.value) &&
        (!contentFilter.value || event.contentId === contentFilter.value) &&
        (!regionFilter.value || (prefixes.length === 3 && event.regions.some(address => address.every((prefix, axis) =>
            prefix.startsWith(prefixes[axis]!) || prefixes[axis]!.startsWith(prefix)))));
}));

async function resync() {
    const epoch = ++revision;
    connection.value = 'Syncing';
    try {
        const params = new URLSearchParams({ limit: '256' });
        if (category.value) params.set('category', category.value);
        if (nameFilter.value) params.set('name', nameFilter.value);
        if (kindFilter.value) params.set('kind', kindFilter.value);
        if (contentFilter.value) params.set('contentId', contentFilter.value);
        const { events, total } = await dashboardRequest<{ events: ActivityEvent[]; total: number }>(`/api/v1/activity?${params}`);
        if (epoch !== revision) return;
        totalStored.value = total;
        const known = new Set(events.map(event => event.id));
        const newer = incoming.value.filter(event => !known.has(event.id) && (!events.length || event.time >= events[0]!.time));
        incoming.value = [...newer, ...events].slice(0, 256);
        connection.value = 'Live';
        error.value = '';
    } catch (cause) {
        if (epoch !== revision) return;
        error.value = (cause as Error).message;
        clearTimeout(retry);
        retry = setTimeout(() => void resync(), 2500);
    }
}

async function emitEvent() {
    error.value = '';
    notice.value = '';
    try {
        await dashboardRequest('/api/v1/events', {
            method: 'POST',
            body: JSON.stringify({
                name: eventName.value,
                data: JSON.parse(eventData.value),
                ...(useRegion.value && eventRegion.value.trim() ? { region: JSON.parse(eventRegion.value) } : {}),
            }),
        });
        notice.value = `Emitted ${eventName.value}.`;
    } catch (cause) { error.value = (cause as Error).message; }
}

function showAtlas(event: ActivityEvent) {
    sessionStorage.setItem('substratum.atlas-regions', JSON.stringify(event.regions));
    window.location.assign('/atlas?regions=1');
}

onMounted(() => {
    source = new EventSource('/api/v1/events?activity=1');
    source.addEventListener('ready', () => void resync());
    source.addEventListener('activity', event => {
        const item = JSON.parse(event.data) as ActivityEvent;
        if (!incoming.value.some(existing => existing.id === item.id)) {
            incoming.value = [item, ...incoming.value].slice(0, 256);
            totalStored.value++;
        }
    });
    source.onerror = () => {
        ++revision;
        clearTimeout(retry);
        connection.value = 'Reconnecting';
    };
});
onUnmounted(() => { ++revision; clearTimeout(retry); source?.close(); });
</script>

<template>
  <div class="workspace-stack">
    <section class="workspace-panel">
      <div class="workspace-panel-header">
        <h2>Event feed</h2>
        <span class="badge" :class="connection === 'Live' ? 'ok' : 'warn'" role="status">
          {{ connection }}<template v-if="frozen"> · Paused</template>
        </span>
        <span class="badge">{{ totalStored }} persisted</span>
        <button @click="resync">Reload from DB</button>
        <button @click="frozen = frozen ? null : [...incoming]">{{ frozen ? 'Resume display' : 'Pause display' }}</button>
      </div>
      <div class="workspace-fields">
        <label>Category
          <select v-model="category" @change="resync">
            <option value="">All events</option>
            <option value="mutation">Mutations</option>
            <option value="transition">Content transitions</option>
            <option value="spatial">Spatial changes</option>
            <option value="veto">Middleware vetoes</option>
            <option value="custom">Domain events</option>
            <option value="diagnostic">Diagnostics</option>
          </select>
        </label>
        <label>Event name <input v-model="nameFilter" placeholder="e.g. spatial:change" /></label>
        <label>Region prefixes (X / Y / Z) <input v-model="regionFilter" placeholder="* / 10 / *" class="monospace" /></label>
        <label>Exact kind <input v-model="kindFilter" /></label>
        <label>Content ID <input v-model="contentFilter" class="monospace" /></label>
      </div>
      <p v-if="!items.length">No matching events in the activity log.</p>
      <ol v-else class="activity-log">
        <li v-for="item in items" :key="item.id">
          <details>
            <summary>
              <time :datetime="new Date(item.time).toISOString()">{{ dates.format(item.time) }}</time>
              <span class="badge" :class="item.category === 'veto' || item.level === 'error' ? 'err' : 'accent'">{{ item.category }}</span>
              <strong>{{ item.name }}</strong>
              <code v-if="item.contentId">{{ item.contentId }}</code>
            </summary>
            <div class="activity-detail">
              <p>
                Principal: <strong>{{ item.principal.type }}</strong>
                <template v-if="item.principal.type === 'client'"> · <code>{{ item.principal.clientId }}</code></template>
                <template v-if="item.source"> · Source: <code>{{ item.source }}</code></template>
              </p>
              <div v-if="item.regions.length" class="workspace-actions">
                <span>{{ item.regions.length }} regions · <code>{{ formatAddress(item.regions[0]!) }}</code></span>
                <button @click="showAtlas(item)">Highlight in Atlas</button>
              </div>
              <pre>{{ JSON.stringify(item.data, null, 2) }}</pre>
            </div>
          </details>
        </li>
      </ol>
    </section>

    <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="workspace-notice" role="status">{{ notice }}</p>

    <section class="workspace-panel">
      <h2>Emit custom event</h2>
      <form class="workspace-stack" @submit.prevent="emitEvent">
        <div class="workspace-fields">
          <label>Event name <input v-model="eventName" required placeholder="survey:completed" /></label>
          <label class="workspace-check"><input v-model="useRegion" type="checkbox" /> Scope to spatial region</label>
        </div>
        <AddressBuilder v-if="useRegion" v-model:mode="regionMode" v-model="eventRegion" />
        <JsonEditor v-model="eventData" label="Payload JSON" :rows="4" />
        <div><button class="workspace-primary" type="submit">Emit event</button></div>
      </form>
    </section>
  </div>
</template>

<style scoped>
.activity-log { list-style: none; padding: 0; max-height: 58vh; overflow: auto; margin: 12px 0 0; }
.activity-log li { border-top: 1px solid var(--border-subtle); padding: 10px 0; font-size: 13px; }
.activity-log summary { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.activity-log time { color: var(--text-muted); font-family: var(--font-mono); font-size: 12px; }
.activity-detail { padding: 10px 0 0 12px; }
</style>
