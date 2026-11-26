<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { Address } from '@svaltek/substratum';
import type { RegionMode } from '../workspace/RegionFields.vue';
import AddressBuilder from '../ui/AddressBuilder.vue';
import JsonEditor from '../ui/JsonEditor.vue';
import { dashboardRequest, dashboardResponse } from '../../lib/dashboard-api';
import { atlasLink, formatAddress } from '../../lib/workspace-types';

type Method = 'search' | 'nearest' | 'radius' | 'cells/search';
interface Config {
    method: Method; regionMode: RegionMode; region: string; at: string; radius: number; overlap: boolean;
    kind: string; tags: string; where: string; unique: boolean; limit: number;
}
interface Result { address: Address; id?: string; kind?: string; distance?: number; metadata?: unknown }
const config = reactive<Config>({
    method: 'search', regionMode: 'all', region: '', at: '[0, 0, 0]', radius: 100,
    overlap: false, kind: '', tags: '', where: '{}', unique: false, limit: 50,
});
const saved = ref<{ name: string; config: Config }[]>([]);
const saveName = ref('');
const results = ref<Result[] | null>(null);
const elapsed = ref<string | null>(null);
const display = ref<'table' | 'json'>('table');
const busy = ref(false);
const error = ref('');
const spatial = computed(() => config.method === 'search' || config.method === 'cells/search');

async function loadSaved() {
    try {
        const res = await dashboardRequest<{ queries: { name: string; config: Config }[] }>('/api/v1/queries');
        saved.value = res.queries;
    } catch { /* Non-fatal if empty */ }
}

async function save() {
    const name = saveName.value.trim();
    if (!name) return;
    try {
        await dashboardRequest('/api/v1/queries', {
            method: 'POST', body: JSON.stringify({ name, config: { ...config } }),
        });
        saveName.value = '';
        await loadSaved();
    } catch (cause) { error.value = (cause as Error).message; }
}

async function remove(name: string) {
    try {
        await dashboardRequest('/api/v1/queries', {
            method: 'DELETE', body: JSON.stringify({ name }),
        });
        await loadSaved();
    } catch (cause) { error.value = (cause as Error).message; }
}

async function run() {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try {
        const body: Record<string, unknown> = { limit: config.limit };
        if (spatial.value) {
            if (config.regionMode !== 'all') body.region = JSON.parse(config.region);
            body.overlap = config.overlap;
        } else {
            body.at = JSON.parse(config.at);
            if (config.method === 'radius') body.radius = config.radius;
        }
        if (config.method !== 'cells/search') {
            if (config.kind.trim()) body.kind = config.kind;
            if (config.tags.trim()) body.tags = config.tags.split(',').map(tag => tag.trim()).filter(Boolean);
            if (config.where.trim()) body.where = JSON.parse(config.where);
            if (config.method === 'search') body.unique = config.unique;
        }
        const response = await dashboardResponse(`/api/v1/${config.method}`, { method: 'POST', body: JSON.stringify(body) });
        results.value = await response.json() as Result[];
        elapsed.value = response.headers.get('X-Query-Time-Ms');
    } catch (cause) {
        results.value = null;
        error.value = (cause as Error).message;
    } finally {
        busy.value = false;
    }
}

function showAtlas() {
    sessionStorage.setItem('substratum.atlas-query', JSON.stringify(results.value?.map(item => item.address) ?? []));
    window.location.assign('/atlas?query=1');
}

onMounted(loadSaved);
</script>

<template>
  <div class="workspace-stack">
    <section class="workspace-panel">
      <h2>Query configuration</h2>
      <form class="workspace-stack" @submit.prevent="run">
        <div class="workspace-fields">
          <label>Query
            <select v-model="config.method">
              <option value="search">Spatial content search</option>
              <option value="cells/search">Spatial cell search</option>
              <option value="nearest">Nearest content</option>
              <option value="radius">Content within radius</option>
            </select>
          </label>
          <label>Maximum results <input v-model.number="config.limit" type="number" min="1" max="1000" required /></label>
        </div>

        <template v-if="spatial">
          <AddressBuilder v-model:mode="config.regionMode" v-model="config.region" allow-all />
          <label class="workspace-check"><input v-model="config.overlap" type="checkbox" /> Include overlapping cells</label>
        </template>
        <div v-else class="workspace-fields">
          <label>Point [X, Y, Z] <input v-model="config.at" class="monospace" required /></label>
          <label v-if="config.method === 'radius'">Radius <input v-model.number="config.radius" type="number" min="0" step="any" required /></label>
        </div>

        <fieldset v-if="config.method !== 'cells/search'">
          <legend>Attachment filters</legend>
          <div class="workspace-fields">
            <label>Kind <input v-model="config.kind" /></label>
            <label>Tags (comma separated) <input v-model="config.tags" /></label>
          </div>
          <JsonEditor v-model="config.where" label="Metadata match JSON" :rows="3" />
          <label v-if="config.method === 'search'" class="workspace-check"><input v-model="config.unique" type="checkbox" /> Deduplicate by content identity</label>
        </fieldset>

        <div><button type="submit" class="workspace-primary" :disabled="busy">Run query</button></div>
      </form>
    </section>

    <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>

    <section v-if="results" class="workspace-panel">
      <div class="workspace-panel-header">
        <h2>Results</h2>
        <span class="badge ok" role="status">{{ results.length }} returned <template v-if="elapsed">· {{ elapsed }} ms</template></span>
        <button :aria-pressed="display === 'table'" @click="display = 'table'">Table</button>
        <button :aria-pressed="display === 'json'" @click="display = 'json'">JSON</button>
        <button :disabled="!results.length" @click="showAtlas">View results in Atlas</button>
      </div>
      <pre v-if="display === 'json'">{{ JSON.stringify(results, null, 2) }}</pre>
      <div v-else class="workspace-table-scroll">
        <table class="workspace-table">
          <thead><tr><th>Address</th><th>Content ID</th><th>Kind</th><th>Distance</th></tr></thead>
          <tbody>
            <tr v-for="(item, index) in results" :key="index">
              <th scope="row"><a :href="atlasLink(item.address, item.id)"><code>{{ formatAddress(item.address) }}</code></a></th>
              <td><code>{{ item.id ?? '—' }}</code></td>
              <td>{{ item.kind ?? '—' }}</td>
              <td>{{ item.distance ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="workspace-panel">
      <h2>Saved queries (server-persisted)</h2>
      <form class="workspace-inline" @submit.prevent="save">
        <label>Query name <input v-model="saveName" maxlength="100" required placeholder="Survey relays" /></label>
        <button type="submit">Save configuration</button>
      </form>
      <ul v-if="saved.length" class="workspace-stack" style="list-style:none;padding:0;margin-top:12px">
        <li v-for="item in saved" :key="item.name" class="workspace-actions">
          <button @click="Object.assign(config, item.config)">{{ item.name }}</button>
          <button class="workspace-danger" :aria-label="`Remove saved query ${item.name}`" @click="remove(item.name)">Remove</button>
        </li>
      </ul>
    </section>
  </div>
</template>
