<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { Address } from '@svaltek/substratum';
import PageControls from '../workspace/PageControls.vue';
import ConfirmDialog from '../ui/ConfirmDialog.vue';
import JsonEditor from '../ui/JsonEditor.vue';
import AddressBuilder from '../ui/AddressBuilder.vue';
import type { RegionMode } from '../workspace/RegionFields.vue';
import { dashboardRequest } from '../../lib/dashboard-api';
import { useWorkspaceLive } from '../../lib/workspace-live';
import { atlasLink, cellLink, formatAddress } from '../../lib/workspace-types';
import type { ContentRecord, ContentRow, Page } from '../../lib/workspace-types';

const search = ref('');
const kindFilter = ref('');
const orphansOnly = ref(false);
const page = ref(1);
const records = ref<Page<ContentRow> | null>(null);
const selected = ref<ContentRecord | null>(null);
const creating = ref(false);
const draftKind = ref('');
const payload = ref('{\n  \n}');
const attachMode = ref<RegionMode>('box');
const attachRegion = ref('{"at":[0,0,0],"extent":[1,1,1]}');
const attachMeta = ref('{}');
const confirmRemove = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const draftChanged = computed(() => selected.value && payload.value !== JSON.stringify(selected.value.payload, null, 2));
let listRevision = 0;
let selectionRevision = 0;

function contentPath(id: string) { return `/api/v1/contents/${encodeURIComponent(id)}`; }

async function loadList() {
    const revision = ++listRevision;
    const params = new URLSearchParams({
        page: String(page.value), q: search.value, kind: kindFilter.value, orphans: String(orphansOnly.value),
    });
    try {
        const result = await dashboardRequest<Page<ContentRow>>(`/api/v1/contents?${params}`);
        if (revision !== listRevision) return;
        const lastPage = Math.max(1, Math.ceil(result.total / result.limit));
        if (result.page > lastPage) {
            page.value = lastPage;
            return await loadList();
        }
        records.value = result;
    } catch (cause) {
        if (revision === listRevision) error.value = (cause as Error).message;
    }
}

async function select(id: string, preserveDraft = false) {
    const revision = ++selectionRevision;
    try {
        const record = await dashboardRequest<ContentRecord>(contentPath(id));
        if (revision !== selectionRevision) return;
        selected.value = record;
        if (!preserveDraft) payload.value = JSON.stringify(record.payload, null, 2);
        creating.value = false;
    } catch (cause) {
        if (revision === selectionRevision) error.value = (cause as Error).message;
    }
}

function changePage(value: number) {
    page.value = value;
    error.value = '';
    void loadList();
}

function beginCreate() {
    ++selectionRevision;
    selected.value = null;
    creating.value = true;
    draftKind.value = '';
    payload.value = '{}';
    error.value = '';
    notice.value = '';
}

function closeEditor() {
    ++selectionRevision;
    selected.value = null;
    creating.value = false;
}

async function save() {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
        const data: unknown = JSON.parse(payload.value);
        if (creating.value) {
            const { id } = await dashboardRequest<{ id: string }>('/api/v1/contents', {
                method: 'POST', body: JSON.stringify({ kind: draftKind.value, payload: data }),
            });
            await select(id);
            notice.value = 'Content created.';
        } else if (selected.value) {
            const id = selected.value.id;
            await dashboardRequest(contentPath(id), { method: 'PATCH', body: JSON.stringify({ payload: data }) });
            await select(id);
            notice.value = 'Payload saved.';
        }
        await loadList();
    } catch (cause) {
        error.value = (cause as Error).message;
    } finally {
        busy.value = false;
    }
}

async function attachToCell() {
    if (!selected.value || busy.value) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
        const region = JSON.parse(attachRegion.value);
        let address: Address;
        if (attachMode.value === 'address') {
            address = region as Address;
        } else {
            const geom = await dashboardRequest<{ cover: Address }>('/api/v1/geometry', {
                method: 'POST', body: JSON.stringify({ region }),
            });
            address = geom.cover;
        }
        await dashboardRequest('/api/v1/placements', {
            method: 'POST',
            body: JSON.stringify({ id: selected.value.id, address, metadata: JSON.parse(attachMeta.value) }),
        });
        notice.value = `Attached to ${formatAddress(address)}.`;
        await Promise.all([select(selected.value.id, Boolean(draftChanged.value)), loadList()]);
    } catch (cause) {
        error.value = (cause as Error).message;
    } finally {
        busy.value = false;
    }
}

async function remove() {
    const record = selected.value;
    if (!record || busy.value) return;
    busy.value = true;
    error.value = '';
    try {
        await dashboardRequest(contentPath(record.id), { method: 'DELETE' });
        ++selectionRevision;
        selected.value = null;
        notice.value = 'Content removed.';
        await loadList();
    } catch (cause) {
        error.value = (cause as Error).message;
    } finally {
        busy.value = false;
        confirmRemove.value = false;
    }
}

const connection = useWorkspaceLive(async () => {
    await loadList();
    if (selected.value && !busy.value) void select(selected.value.id, Boolean(draftChanged.value));
});

onMounted(() => {
    const id = new URLSearchParams(location.search).get('id');
    if (id) void select(id);
});
</script>

<template>
  <div class="workspace-stack">
    <ConfirmDialog
      :open="confirmRemove"
      title="Remove content record"
      :message="`Permanently delete content ${selected?.id ?? ''}? This cannot be undone.`"
      confirm-label="Remove content"
      danger
      :busy="busy"
      @cancel="confirmRemove = false"
      @confirm="remove"
    />

    <section class="workspace-panel">
      <div class="workspace-panel-header">
        <h2>Content records</h2>
        <span class="badge" role="status">{{ connection }}</span>
        <button class="workspace-primary" :disabled="busy" @click="beginCreate">New content</button>
      </div>
      <form class="workspace-inline" @submit.prevent="changePage(1)">
        <label>Search ID or kind <input v-model="search" type="search" /></label>
        <label>Exact kind <input v-model="kindFilter" /></label>
        <label class="workspace-check"><input v-model="orphansOnly" type="checkbox" /> Orphans only</label>
        <button type="submit">Apply filters</button>
      </form>
      <p v-if="!records">Loading content…</p>
      <p v-else-if="!records.total">No matching content.</p>
      <template v-else>
        <div class="workspace-table-scroll">
          <table class="workspace-table">
            <thead><tr><th>Content ID</th><th>Kind</th><th>Placements</th></tr></thead>
            <tbody>
              <tr v-for="item in records.items" :key="item.id">
                <th scope="row"><button :disabled="busy" @click="select(item.id)"><code>{{ item.id }}</code></button></th>
                <td><span class="badge accent">{{ item.kind }}</span></td>
                <td>
                  <span class="badge" :class="item.placements ? 'ok' : 'warn'">{{ item.placements || 'Orphan' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <PageControls :page="records.page" :limit="records.limit" :total="records.total" @change="changePage" />
      </template>
    </section>

    <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="workspace-notice" role="status">{{ notice }}</p>

    <section v-if="creating || selected" class="workspace-panel">
      <div class="workspace-panel-header">
        <h2>{{ creating ? 'New content' : selected?.kind }}</h2>
        <code v-if="selected">{{ selected.id }}</code>
      </div>
      <form class="workspace-stack" @submit.prevent="save">
        <label v-if="creating">Content kind <input v-model="draftKind" maxlength="256" required placeholder="observation" /></label>
        <JsonEditor v-model="payload" label="JSON payload" :rows="8" />
        <div class="workspace-actions">
          <button class="workspace-primary" type="submit" :disabled="busy">{{ creating ? 'Create content' : 'Save payload' }}</button>
          <button v-if="selected && !selected.placements.length" class="workspace-danger" type="button" :disabled="busy" @click="confirmRemove = true">Remove content</button>
          <button type="button" :disabled="busy" @click="closeEditor">Close editor</button>
        </div>
      </form>

      <template v-if="selected">
        <h3>Placements ({{ selected.placements.length }})</h3>
        <p v-if="!selected.placements.length">This content is currently unplaced (orphan).</p>
        <ul v-else class="workspace-stack" style="list-style:none;padding:0">
          <li v-for="address in selected.placements" :key="formatAddress(address)" class="workspace-actions">
            <a :href="cellLink(address)"><code>{{ formatAddress(address) }}</code></a>
            <a class="workspace-button" :href="atlasLink(address, selected.id)">Show in Atlas</a>
          </li>
        </ul>

        <form class="workspace-stack" style="margin-top:16px" @submit.prevent="attachToCell">
          <h3>Attach to another location</h3>
          <AddressBuilder v-model:mode="attachMode" v-model="attachRegion" />
          <JsonEditor v-model="attachMeta" label="Attachment metadata &amp; tags JSON" :rows="3" />
          <div><button type="submit" :disabled="busy">Attach placement</button></div>
        </form>
      </template>
    </section>
  </div>
</template>
