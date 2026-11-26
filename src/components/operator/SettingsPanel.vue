<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { dashboardRequest } from '../../lib/dashboard-api';
import ConfirmDialog from '../ui/ConfirmDialog.vue';

interface Settings {
    startup: {
        host: string; port: number; bits: number; databasePath: string; pluginsDirectory: string; sessionTtlSeconds: number;
        cookieSecure: boolean; publicOrigin: string | null;
    };
    runtime: { activeDashboardSessions: number; scheduler: { intervalMs: number; running: boolean } };
    logging: { runtimeDiagnostics: string; limit: number };
}
const data = ref<Settings | null>(null);
const retention = ref(2000);
const confirmRevoke = ref(false);
const error = ref('');
const notice = ref('');
const busy = ref(false);

async function load() {
    try {
        data.value = await dashboardRequest<Settings>('/api/v1/operator/settings');
        retention.value = data.value.logging.limit;
    } catch (cause) { error.value = (cause as Error).message; }
}
onMounted(load);

async function saveRetention() {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
        await dashboardRequest('/api/v1/operator/settings', {
            method: 'POST', body: JSON.stringify({ operation: 'set-retention', limit: retention.value }),
        });
        notice.value = `Activity log retention updated to ${retention.value} records.`;
        await load();
    } catch (cause) { error.value = (cause as Error).message; }
    finally { busy.value = false; }
}

async function revoke() {
    if (busy.value) return;
    busy.value = true;
    try {
        await dashboardRequest('/api/v1/operator/settings', {
            method: 'POST', body: JSON.stringify({ operation: 'revoke-sessions', confirm: 'revoke-sessions' }),
        });
        window.location.assign('/login');
    } catch (cause) { error.value = (cause as Error).message; }
    finally { busy.value = false; confirmRevoke.value = false; }
}
</script>

<template>
  <div class="workspace-stack">
    <ConfirmDialog
      :open="confirmRevoke"
      title="Revoke all dashboard sessions"
      message="Every active dashboard session—including your current one—will be signed out immediately."
      confirm-label="Revoke all sessions"
      danger
      :busy="busy"
      @cancel="confirmRevoke = false"
      @confirm="revoke"
    />
    <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="workspace-notice" role="status">{{ notice }}</p>
    <p v-if="!data">Loading effective settings…</p>
    <template v-else>
      <section class="workspace-panel">
        <div class="workspace-panel-header">
          <h2>Runtime-editable settings</h2>
          <span class="badge ok">Mutable at runtime</span>
        </div>
        <form class="workspace-inline" @submit.prevent="saveRetention">
          <label>Activity &amp; diagnostic log retention (100–20000 records)
            <input v-model.number="retention" type="number" min="100" max="20000" step="100" required />
          </label>
          <button class="workspace-primary" type="submit" :disabled="busy">Save retention</button>
        </form>
        <div class="workspace-actions" style="margin-top:16px">
          <span class="badge">Scheduler: {{ data.runtime.scheduler.running ? `${data.runtime.scheduler.intervalMs} ms` : 'Stopped' }}</span>
          <a class="workspace-button" href="/plugins">Configure plugin scheduler</a>
          <a class="workspace-button" href="/clients">Manage API clients</a>
        </div>
        <div class="workspace-actions" style="margin-top:16px">
          <span>{{ data.runtime.activeDashboardSessions }} active dashboard sessions</span>
          <button class="workspace-danger" :disabled="busy" @click="confirmRevoke = true">Revoke all dashboard sessions</button>
        </div>
      </section>

      <section class="workspace-panel">
        <div class="workspace-panel-header">
          <h2>Startup configuration</h2>
          <span class="badge">Read-only (.env / restart required)</span>
        </div>
        <table class="workspace-table">
          <tbody>
            <tr><th scope="row">Listen address</th><td><code>{{ data.startup.host }}:{{ data.startup.port }}</code></td></tr>
            <tr><th scope="row">Public origin</th><td>{{ data.startup.publicOrigin ?? 'Request origin' }}</td></tr>
            <tr><th scope="row">SQLite database</th><td><code>{{ data.startup.databasePath }}</code></td></tr>
            <tr><th scope="row">World resolution</th><td>{{ data.startup.bits }} bits per axis</td></tr>
            <tr><th scope="row">Plugin directory</th><td><code>{{ data.startup.pluginsDirectory }}</code></td></tr>
            <tr><th scope="row">Dashboard session duration</th><td>{{ data.startup.sessionTtlSeconds }} seconds</td></tr>
            <tr><th scope="row">Secure dashboard cookies</th><td>{{ data.startup.cookieSecure ? 'Required' : 'Disabled' }}</td></tr>
            <tr><th scope="row">Diagnostics store</th><td>{{ data.logging.runtimeDiagnostics }}</td></tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>
