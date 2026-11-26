<script setup lang="ts">
import { ref } from 'vue';
import { dashboardRequest } from '../../lib/dashboard-api';
import { useWorkspaceLive } from '../../lib/workspace-live';
import ConfirmDialog from '../ui/ConfirmDialog.vue';

type Counts = Record<'cells' | 'attachments' | 'contents' | 'orphans', number>;
interface Storage {
    databasePath: string; journal: string; allocatedBytes: number; counts: Counts; runtime: Counts; matching: boolean;
    backups: { id: string; label: string; bytes: number; createdAt: number }[];
}
interface ValidationResult {
    ok: boolean;
    database: string[];
    foreignKeys: number;
    runtime: boolean;
    matching: boolean;
}

const details = ref<Storage | null>(null);
const label = ref('');
const selectedFile = ref<File | null>(null);
const validation = ref<ValidationResult | null>(null);
const confirmAction = ref<{ title: string; message: string; confirmLabel: string; danger?: boolean; run: () => Promise<void> } | null>(null);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const base = '/api/v1/operator';
const numbers = new Intl.NumberFormat();
const dates = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const countFields = ['cells', 'attachments', 'contents', 'orphans'] as const;

async function load() {
    try { details.value = await dashboardRequest<Storage>(`${base}/storage`); }
    catch (cause) { error.value = (cause as Error).message; }
}

async function execute(action: () => Promise<void>) {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    try { await action(); await load(); }
    catch (cause) { error.value = (cause as Error).message; }
    finally { busy.value = false; confirmAction.value = null; }
}

function storagePost<T>(data: object) {
    return dashboardRequest<T>(`${base}/storage`, { method: 'POST', body: JSON.stringify(data) });
}
function validate() {
    return execute(async () => { validation.value = await storagePost<ValidationResult>({ operation: 'validate' }); });
}
function createBackup() {
    return execute(async () => {
        await storagePost({ operation: 'backup', label: label.value });
        label.value = '';
        notice.value = 'Backup created.';
    });
}
function promptRestore(item: Storage['backups'][number]) {
    confirmAction.value = {
        title: `Restore backup "${item.label}"`,
        message: 'This will replace the current world with the selected backup. An automatic safety backup of the current world will be saved first.',
        confirmLabel: 'Restore backup',
        danger: true,
        run: () => execute(async () => {
            await storagePost({ operation: 'restore', id: item.id, confirm: 'restore' });
            notice.value = `Restored backup "${item.label}".`;
        }),
    };
}
function promptDeleteBackup(item: Storage['backups'][number]) {
    confirmAction.value = {
        title: `Delete backup "${item.label}"`,
        message: 'This backup snapshot will be permanently removed from SQLite.',
        confirmLabel: 'Delete backup',
        danger: true,
        run: () => execute(async () => {
            await storagePost({ operation: 'delete-backup', id: item.id });
            notice.value = `Deleted backup "${item.label}".`;
        }),
    };
}
function promptCollectOrphans() {
    confirmAction.value = {
        title: 'Collect orphaned content',
        message: 'Permanently delete all unattached content records from both the runtime and SQLite?',
        confirmLabel: 'Collect orphans',
        danger: true,
        run: () => execute(async () => {
            const { count } = await storagePost<{ count: number }>({ operation: 'collect-orphans', confirm: 'collect-orphans' });
            notice.value = `Removed ${count} orphan records.`;
        }),
    };
}
function promptImportSnapshot() {
    const file = selectedFile.value;
    if (!file) return;
    confirmAction.value = {
        title: `Import snapshot "${file.name}"`,
        message: 'Replacing the world from a snapshot overwrites current cells and content. A safety backup will be created first.',
        confirmLabel: 'Replace world',
        danger: true,
        run: () => execute(async () => {
            if (file.size > 25 * 1024 * 1024) throw new Error('The snapshot exceeds the 25 MiB import limit.');
            await dashboardRequest('/api/v1/snapshot', { method: 'POST', headers: { 'X-Confirm-Snapshot': 'replace' }, body: file });
            notice.value = 'Snapshot imported.';
        }),
    };
}
function download(id?: string) {
    return execute(async () => {
        const result = await dashboardRequest(id ? `${base}/backup?id=${encodeURIComponent(id)}` : '/api/v1/snapshot');
        const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = id ? `substratum-backup-${id}.json` : 'substratum-snapshot.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
}
const connection = useWorkspaceLive(load);
</script>

<template>
  <div class="workspace-stack">
    <ConfirmDialog
      :open="!!confirmAction"
      :title="confirmAction?.title ?? ''"
      :message="confirmAction?.message ?? ''"
      :confirm-label="confirmAction?.confirmLabel"
      :danger="confirmAction?.danger"
      :busy="busy"
      @cancel="confirmAction = null"
      @confirm="confirmAction?.run()"
    />
    <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="workspace-notice" role="status">{{ notice }}</p>

    <section class="workspace-panel">
      <div class="workspace-panel-header">
        <h2>SQLite database</h2>
        <span class="badge" :class="details?.matching ? 'ok' : 'warn'">{{ details?.matching ? 'In sync' : 'Checking' }}</span>
        <span class="badge" role="status">{{ connection }}</span>
      </div>
      <template v-if="details">
        <p><code>{{ details.databasePath }}</code> · {{ numbers.format(details.allocatedBytes) }} bytes · {{ details.journal.toUpperCase() }}</p>
        <table class="workspace-table">
          <thead><tr><th>Record</th><th>Runtime</th><th>On disk</th><th>Status</th></tr></thead>
          <tbody>
            <tr v-for="key in countFields" :key="key">
              <th scope="row">{{ key }}</th>
              <td>{{ numbers.format(details.runtime[key]) }}</td>
              <td>{{ numbers.format(details.counts[key]) }}</td>
              <td><span class="badge" :class="details.runtime[key] === details.counts[key] ? 'ok' : 'err'">{{ details.runtime[key] === details.counts[key] ? 'Match' : 'Mismatch' }}</span></td>
            </tr>
          </tbody>
        </table>
      </template>
      <p v-else>Loading database information…</p>
      <div class="workspace-actions workspace-pages">
        <button :disabled="busy" @click="validate">Validate consistency</button>
        <button class="workspace-danger" :disabled="busy || !details?.counts.orphans" @click="promptCollectOrphans">Collect orphans ({{ details?.counts.orphans ?? 0 }})</button>
      </div>
      <div v-if="validation" class="validation-grid">
        <div class="badge" :class="validation.ok ? 'ok' : 'err'">Overall: {{ validation.ok ? 'Healthy' : 'Failed' }}</div>
        <div class="badge" :class="validation.database[0] === 'ok' ? 'ok' : 'err'">PRAGMA quick_check: {{ validation.database.join(', ') }}</div>
        <div class="badge" :class="!validation.foreignKeys ? 'ok' : 'err'">Foreign key violations: {{ validation.foreignKeys }}</div>
        <div class="badge" :class="validation.runtime ? 'ok' : 'err'">Runtime indexes: {{ validation.runtime ? 'Valid' : 'Invalid' }}</div>
        <div class="badge" :class="validation.matching ? 'ok' : 'err'">Payload parity: {{ validation.matching ? 'Exact' : 'Diverged' }}</div>
      </div>
    </section>

    <section class="workspace-panel">
      <h2>Snapshots</h2>
      <div class="workspace-actions">
        <button :disabled="busy" @click="download()">Export snapshot</button>
        <label>Snapshot file <input type="file" accept=".json,application/json" @change="selectedFile = ($event.target as HTMLInputElement).files?.[0] ?? null" /></label>
        <button class="workspace-danger" :disabled="busy || !selectedFile" @click="promptImportSnapshot">Replace world from snapshot</button>
      </div>
    </section>

    <section class="workspace-panel">
      <h2>Backups</h2>
      <p>Backups preserve the current world and can be downloaded as standalone snapshot files.</p>
      <form class="workspace-inline" @submit.prevent="createBackup">
        <label>Backup label <input v-model="label" maxlength="120" required placeholder="Before migration" /></label>
        <button class="workspace-primary" type="submit" :disabled="busy">Create backup</button>
      </form>
      <p v-if="!details?.backups.length">No backups to display.</p>
      <div v-else class="workspace-table-scroll">
        <table class="workspace-table">
          <thead><tr><th>Label</th><th>Created</th><th>Size</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="item in details.backups" :key="item.id">
              <th scope="row">{{ item.label }}</th>
              <td>{{ dates.format(item.createdAt) }}</td>
              <td>{{ numbers.format(item.bytes) }} B</td>
              <td>
                <div class="workspace-actions compact">
                  <button :disabled="busy" @click="download(item.id)">Download</button>
                  <button :disabled="busy" @click="promptRestore(item)">Restore</button>
                  <button class="workspace-danger" :disabled="busy" @click="promptDeleteBackup(item)">Delete</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.validation-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
</style>
