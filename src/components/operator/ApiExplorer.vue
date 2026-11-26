<script setup lang="ts">
import { computed, ref } from 'vue';
import { contractGroups, type EndpointDoc } from '../../lib/api-contracts';
import ConfirmDialog from '../ui/ConfirmDialog.vue';
import JsonEditor from '../ui/JsonEditor.vue';
import EndpointCard from './EndpointCard.vue';

const method = ref('GET');
const path = ref('/api/v1/stats');
const authMode = ref<'session' | 'bearer'>('session');
const bearerToken = ref('');
const clientIdHeader = ref('');
const body = ref('');
const confirmation = ref('');
const result = ref('');
const status = ref('');
const error = ref('');
const busy = ref(false);
const pendingTarget = ref<URL | null>(null);
const filterQuery = ref('');
const expandedIds = ref<Set<string>>(new Set());
const builderRef = ref<HTMLElement | null>(null);

const examples = [
    'Authorization: Bearer <management-token>',
    'Authorization: Bearer <client-secret>\nX-Substratum-Client: <percent-encoded-client-id>',
    'curl -N -H "Authorization: Bearer <client-secret>" \\\n  -H "X-Substratum-Client: survey-worker" http://127.0.0.1:4321/api/v1/events',
];

const filteredGroups = computed(() => {
    const query = filterQuery.value.trim().toLowerCase();
    if (!query) return contractGroups;
    return contractGroups
        .map(group => ({
            ...group,
            entries: group.entries.filter(entry =>
                entry.path.toLowerCase().includes(query) ||
                entry.method.toLowerCase().includes(query) ||
                entry.summary.toLowerCase().includes(query) ||
                entry.description.toLowerCase().includes(query),
            ),
        }))
        .filter(group => group.entries.length > 0);
});

function toggleCard(id: string) {
    const next = new Set(expandedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds.value = next;
}

function expandAll() {
    const next = new Set<string>();
    for (const group of filteredGroups.value) {
        for (const entry of group.entries) next.add(entry.id);
    }
    expandedIds.value = next;
}

function collapseAll() {
    expandedIds.value = new Set();
}

function choose(item: EndpointDoc) {
    method.value = item.method;
    path.value = item.loadPath;
    body.value = item.requestExample ?? '';
    confirmation.value = item.confirmation ?? '';
    error.value = '';
    builderRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function submit() {
    if (busy.value) return;
    error.value = '';
    result.value = '';
    status.value = '';
    let target: URL;
    try { target = new URL(path.value, location.origin); }
    catch {
        error.value = 'Enter a valid local API path.';
        return;
    }
    if (target.origin !== location.origin || !target.pathname.startsWith('/api/')) {
        error.value = 'Enter a local /api/ endpoint.';
        return;
    }
    if (path.value.includes('{') || path.value.includes('}')) {
        error.value = 'Replace path placeholders with real record IDs.';
        return;
    }
    if (target.pathname === '/api/auth/login' || target.pathname === '/api/auth/logout') {
        error.value = 'Use the dashboard sign-in and sign-out controls.';
        return;
    }
    if (method.value !== 'GET') {
        pendingTarget.value = target;
        return;
    }
    void execute(target);
}

async function execute(target: URL) {
    busy.value = true;
    try {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (authMode.value === 'bearer' && bearerToken.value.trim()) {
            headers.Authorization = `Bearer ${bearerToken.value.trim()}`;
            if (clientIdHeader.value.trim()) {
                headers['X-Substratum-Client'] = encodeURIComponent(clientIdHeader.value.trim());
            }
        }
        if (body.value && method.value !== 'GET') {
            JSON.parse(body.value);
            headers['Content-Type'] = 'application/json';
        }
        if (confirmation.value) headers['X-Confirm-Snapshot'] = confirmation.value;
        const response = await fetch(target, {
            method: method.value,
            headers,
            credentials: authMode.value === 'session' ? 'same-origin' : 'omit',
            body: method.value !== 'GET' && body.value ? body.value : undefined,
            redirect: 'error',
            signal: AbortSignal.timeout(12000),
        });
        status.value = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
        const type = response.headers.get('Content-Type') ?? '';
        if (type.includes('text/event-stream') && response.body) {
            const reader = response.body.getReader();
            try { result.value = new TextDecoder().decode((await reader.read()).value); }
            finally { await reader.cancel(); }
        } else {
            const text = await response.text();
            try { result.value = JSON.stringify(JSON.parse(text), null, 2); }
            catch { result.value = text; }
        }
    } catch (cause) { error.value = (cause as Error).message; }
    finally { busy.value = false; pendingTarget.value = null; }
}
</script>

<template>
  <div class="workspace-stack">
    <ConfirmDialog
      :open="!!pendingTarget"
      :title="`Send ${method} request`"
      :message="`Execute ${method} ${pendingTarget?.pathname ?? ''} using ${authMode === 'session' ? 'your dashboard session' : 'Bearer token'}?`"
      confirm-label="Send request"
      :busy="busy"
      @cancel="pendingTarget = null"
      @confirm="pendingTarget && execute(pendingTarget)"
    />

    <section ref="builderRef" class="workspace-panel">
      <h2>Request builder</h2>
      <form class="workspace-stack" @submit.prevent="submit">
        <div class="workspace-fields">
          <label>Method
            <select v-model="method"><option>GET</option><option>POST</option><option>PATCH</option><option>DELETE</option></select>
          </label>
          <label>API path <input v-model="path" class="monospace" required /></label>
          <label>Authentication
            <select v-model="authMode">
              <option value="session">Dashboard session cookie</option>
              <option value="bearer">Bearer token (Management or Client)</option>
            </select>
          </label>
        </div>
        <div v-if="authMode === 'bearer'" class="workspace-fields">
          <label>Bearer token <input v-model="bearerToken" type="password" autocomplete="off" placeholder="Management token or client secret" /></label>
          <label>X-Substratum-Client (optional, for client secrets) <input v-model="clientIdHeader" placeholder="survey-worker" /></label>
        </div>
        <JsonEditor v-if="method !== 'GET'" v-model="body" label="Request JSON" :rows="6" />
        <label v-if="method === 'POST' && path.startsWith('/api/v1/snapshot')">Snapshot confirmation header <input v-model="confirmation" /></label>
        <div><button class="workspace-primary" type="submit" :disabled="busy">Send request</button></div>
      </form>
      <p v-if="error" class="workspace-error" role="alert" style="margin-top:12px">{{ error }}</p>
      <template v-if="status">
        <h3>Response <span class="badge">{{ status }}</span></h3>
        <pre>{{ result || '(empty response)' }}</pre>
      </template>
    </section>

    <section class="workspace-panel">
      <h2>Authentication and streaming</h2>
      <p>Switch between your dashboard session and Bearer credentials above to test client permissions directly. On SSE reconnect, resynchronize scoped state.</p>
      <pre v-for="example in examples" :key="example">{{ example }}</pre>
    </section>

    <section class="workspace-panel">
      <div class="workspace-panel-header">
        <h2>Endpoint reference</h2>
        <a class="workspace-button" href="/api/v1/openapi.json" target="_blank" rel="noopener">OpenAPI 3.1 JSON</a>
      </div>
      <div class="explorer-toolbar">
        <input
          v-model="filterQuery"
          type="search"
          placeholder="Filter endpoints by path, method, or description..."
          aria-label="Filter endpoints"
        />
        <div class="workspace-actions">
          <button type="button" @click="expandAll">Expand all</button>
          <button type="button" @click="collapseAll">Collapse all</button>
        </div>
      </div>
    </section>

    <section v-for="group in filteredGroups" :key="group.title" class="workspace-panel">
      <div class="workspace-panel-header">
        <h2>{{ group.title }}</h2>
        <span>{{ group.entries.length }} endpoints</span>
      </div>
      <p class="group-desc">{{ group.description }}</p>
      <div class="endpoint-list">
        <EndpointCard
          v-for="item in group.entries"
          :key="item.id"
          :endpoint="item"
          :expanded="expandedIds.has(item.id)"
          @toggle="toggleCard(item.id)"
          @load="choose"
        />
      </div>
    </section>

    <section v-if="!filteredGroups.length" class="workspace-panel">
      <p>No endpoints match "{{ filterQuery }}".</p>
    </section>
  </div>
</template>

<style scoped>
.explorer-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.explorer-toolbar input {
  flex: 1 1 260px;
}
.group-desc {
  margin: -6px 0 14px;
}
.endpoint-list {
  display: grid;
  gap: 10px;
}
</style>
