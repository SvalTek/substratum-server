<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { Address, Bounds } from '@svaltek/substratum';
import type { RegionMode } from '../workspace/RegionFields.vue';
import PageControls from '../workspace/PageControls.vue';
import AddressBuilder from '../ui/AddressBuilder.vue';
import JsonEditor from '../ui/JsonEditor.vue';
import ConfirmDialog from '../ui/ConfirmDialog.vue';
import { dashboardRequest } from '../../lib/dashboard-api';
import { useWorkspaceLive } from '../../lib/workspace-live';
import { atlasLink, formatAddress } from '../../lib/workspace-types';
import type { CellRecord, CellRow, Page } from '../../lib/workspace-types';

interface Geometry { bounds: Bounds; cover: Address; exact: Address[] | null; bits: number }
const mode = ref<RegionMode>('address');
const region = ref('["", "", ""]');
const preview = ref<Geometry | null>(null);
const page = ref(1);
const listing = ref<Page<CellRow> | null>(null);
const selected = ref<Address | null>(null);
const cell = ref<CellRecord | null>(null);
const cellMetadata = ref('{}');
const contentId = ref('');
const editing = ref<string | null>(null);
const attachmentMetadata = ref('{}');
const destMode = ref<RegionMode>('address');
const destination = ref('["", "", ""]');
const confirmDetachId = ref<string | null>(null);
const busy = ref(false);
const error = ref('');
const notice = ref('');
let listRevision = 0;
let detailRevision = 0;
const endpoint = '/api/v1';

async function loadPage() {
    const revision = ++listRevision;
    try {
        const result = await dashboardRequest<Page<CellRow>>(`${endpoint}/cells?page=${page.value}`);
        if (revision !== listRevision) return;
        const last = Math.max(1, Math.ceil(result.total / result.limit));
        if (page.value > last) {
            page.value = last;
            return await loadPage();
        }
        listing.value = result;
    } catch (cause) {
        if (revision === listRevision) error.value = (cause as Error).message;
    }
}

async function loadCell(address: Address, replaceDraft = true) {
    const revision = ++detailRevision;
    const response = await fetch(`${endpoint}/cells?address=${encodeURIComponent(JSON.stringify(address))}`, { cache: 'no-store' });
    if (response.status === 401) window.location.assign('/login');
    if (response.status !== 404 && !response.ok) throw new Error('Unable to load this cell.');
    const result = response.status === 404 ? null : await response.json() as CellRecord;
    if (revision !== detailRevision) return;
    cell.value = result;
    if (replaceDraft) {
        cellMetadata.value = JSON.stringify(result?.metadata ?? {}, null, 2);
        resetAttachment();
    }
}

async function inspect(address: Address, showGeometry = true) {
    error.value = '';
    selected.value = address;
    cell.value = null;
    cellMetadata.value = '{}';
    resetAttachment();
    try {
        await loadCell(address);
        if (showGeometry) {
            mode.value = 'address';
            region.value = JSON.stringify(address);
            await runPreview();
        }
    } catch (cause) {
        error.value = (cause as Error).message;
    }
}

async function runPreview() {
    error.value = '';
    try {
        preview.value = await dashboardRequest<Geometry>(`${endpoint}/geometry`, {
            method: 'POST', body: JSON.stringify({ region: JSON.parse(region.value) }),
        });
    } catch (cause) {
        preview.value = null;
        error.value = (cause as Error).message;
    }
}

function resetAttachment() {
    editing.value = null;
    contentId.value = '';
    attachmentMetadata.value = '{}';
    destination.value = '["", "", ""]';
}

function editAttachment(attachment: CellRecord['attachments'][number]) {
    editing.value = attachment.id;
    attachmentMetadata.value = JSON.stringify(attachment.metadata, null, 2);
}

async function write(path: string, method: string, data: () => Promise<object> | object, message: string, next?: () => void) {
    if (busy.value || !selected.value) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
        const body = await data();
        await dashboardRequest(`${endpoint}/${path}`, { method, body: JSON.stringify(body) });
        notice.value = message;
        next?.();
        await Promise.all([loadPage(), loadCell(selected.value, false)]);
    } catch (cause) {
        error.value = (cause as Error).message;
    } finally {
        busy.value = false;
        confirmDetachId.value = null;
    }
}

function saveMetadata() {
    return write('cells/metadata', 'PATCH', () => ({
        address: selected.value, metadata: JSON.parse(cellMetadata.value),
    }), 'Cell metadata saved.');
}

function saveAttachment() {
    return write('placements', editing.value ? 'PATCH' : 'POST', () => ({
        id: editing.value ?? contentId.value, address: selected.value, metadata: JSON.parse(attachmentMetadata.value),
    }), 'Attachment saved.', resetAttachment);
}

function confirmDetach() {
    if (!confirmDetachId.value) return;
    const id = confirmDetachId.value;
    void write('placements', 'DELETE', () => ({ id, address: selected.value }), 'Content detached.', resetAttachment);
}

function relocate() {
    return write('placements/relocate', 'POST', async () => {
        const parsed = JSON.parse(destination.value);
        const to = destMode.value === 'address'
            ? parsed
            : (await dashboardRequest<{ cover: Address }>(`${endpoint}/geometry`, { method: 'POST', body: JSON.stringify({ region: parsed }) })).cover;
        return { id: editing.value, from: selected.value, to };
    }, 'Attachment moved.', resetAttachment);
}

const connection = useWorkspaceLive(async () => {
    await loadPage();
    if (selected.value && !busy.value) {
        try { await loadCell(selected.value, false); }
        catch (cause) { error.value = (cause as Error).message; }
    }
});

onMounted(() => {
    const encoded = new URLSearchParams(location.search).get('address');
    if (!encoded) return;
    try { void inspect(JSON.parse(encoded) as Address); }
    catch { error.value = 'Invalid cell address.'; }
});
</script>

<template>
  <div class="workspace-stack">
    <ConfirmDialog
      :open="!!confirmDetachId"
      title="Detach content"
      :message="`Detach ${confirmDetachId ?? ''} from ${selected ? formatAddress(selected) : 'this cell'}?`"
      confirm-label="Detach"
      danger
      :busy="busy"
      @cancel="confirmDetachId = null"
      @confirm="confirmDetach"
    />

    <section class="workspace-panel">
      <h2>Address builder</h2>
      <form class="workspace-stack" @submit.prevent="runPreview">
        <AddressBuilder v-model:mode="mode" v-model="region" />
        <div><button class="workspace-primary" type="submit">Preview region</button></div>
      </form>
      <div v-if="preview" style="margin-top:14px">
        <p>Bounds <code>{{ JSON.stringify(preview.bounds) }}</code> · {{ preview.bits }} bits per axis</p>
        <p>Enclosing cover <code>{{ formatAddress(preview.cover) }}</code></p>
        <div class="workspace-actions">
          <button :disabled="busy" @click="inspect(preview.cover, false)">Inspect cover cell</button>
          <a class="workspace-button" :href="atlasLink(preview.cover)">Show in Atlas</a>
        </div>
        <details style="margin-top:10px">
          <summary>{{ preview.exact ? `Exact decomposition · ${preview.exact.length} cells` : 'Exact decomposition exceeds 256 cells' }}</summary>
          <ul v-if="preview.exact" class="inline-links" style="margin-top:8px">
            <li v-for="address in preview.exact" :key="formatAddress(address)">
              <button :disabled="busy" @click="inspect(address, false)"><code>{{ formatAddress(address) }}</code></button>
            </li>
          </ul>
        </details>
      </div>
    </section>

    <section class="workspace-panel">
      <div class="workspace-panel-header">
        <h2>Stored cells</h2>
        <span class="badge" role="status">{{ connection }}</span>
      </div>
      <p v-if="!listing">Loading cells…</p>
      <p v-else-if="!listing.total">No cells have been stored.</p>
      <template v-else>
        <div class="workspace-table-scroll">
          <table class="workspace-table">
            <thead><tr><th>Address</th><th>Attachments</th></tr></thead>
            <tbody>
              <tr v-for="item in listing.items" :key="formatAddress(item.address)">
                <th scope="row"><button :disabled="busy" @click="inspect(item.address)"><code>{{ formatAddress(item.address) }}</code></button></th>
                <td><span class="badge">{{ item.attachments }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <PageControls :page="listing.page" :limit="listing.limit" :total="listing.total" @change="page = $event; loadPage()" />
      </template>
    </section>

    <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="workspace-notice" role="status">{{ notice }}</p>

    <section v-if="selected" class="workspace-panel">
      <div class="workspace-panel-header">
        <h2>Cell inspector</h2>
        <a class="workspace-button" :href="atlasLink(selected)">Show in Atlas</a>
      </div>
      <p><code>{{ formatAddress(selected) }}</code></p>
      <p v-if="!cell">No stored cell at this address. Save metadata or attach content to create it.</p>
      <form class="workspace-stack" @submit.prevent="saveMetadata">
        <JsonEditor v-model="cellMetadata" label="Cell metadata JSON" :rows="4" />
        <div><button class="workspace-primary" type="submit" :disabled="busy">Save cell metadata</button></div>
      </form>

      <h3>Attachments</h3>
      <p v-if="!cell?.attachments.length">No attachments at this address.</p>
      <ul v-else class="workspace-stack" style="list-style:none;padding:0">
        <li v-for="item in cell.attachments" :key="item.id">
          <div class="workspace-actions">
            <a :href="`/content?id=${encodeURIComponent(item.id)}`"><span class="badge accent">{{ item.kind }}</span> <code>{{ item.id }}</code></a>
            <button :disabled="busy" @click="editAttachment(item)">Edit attachment</button>
            <button class="workspace-danger" :disabled="busy" @click="confirmDetachId = item.id">Detach</button>
          </div>
        </li>
      </ul>

      <form class="workspace-stack" style="margin-top:16px" @submit.prevent="saveAttachment">
        <h3>{{ editing ? 'Edit attachment' : 'Attach existing content' }}</h3>
        <label v-if="!editing">Content ID <input v-model="contentId" required class="monospace" /></label>
        <JsonEditor v-model="attachmentMetadata" label="Attachment metadata &amp; tags JSON" :rows="4" />
        <div class="workspace-actions">
          <button class="workspace-primary" type="submit" :disabled="busy">{{ editing ? 'Save attachment' : 'Attach content' }}</button>
          <button v-if="editing" type="button" @click="resetAttachment">Cancel edit</button>
        </div>
      </form>

      <form v-if="editing" class="workspace-stack" style="margin-top:16px" @submit.prevent="relocate">
        <h3>Relocate attachment</h3>
        <AddressBuilder v-model:mode="destMode" v-model="destination" />
        <div><button type="submit" :disabled="busy">Relocate attachment</button></div>
      </form>
    </section>
  </div>
</template>
