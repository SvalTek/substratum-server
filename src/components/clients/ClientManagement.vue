<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { ClientCredentials, ClientInfo } from '../../lib/clients';
import { dashboardRequest } from '../../lib/dashboard-api';

type Operation = 'issue' | 'reroll' | 'burn';
const clients = ref<ClientInfo[] | null>(null);
const newId = ref('');
const credentials = ref<ClientCredentials | null>(null);
const confirmation = ref<{ operation: 'reroll' | 'burn'; id: string } | null>(null);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const dates = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
let timer: ReturnType<typeof setInterval> | undefined;
let listRequest: AbortController | undefined;

async function refresh() {
    listRequest?.abort();
    const request = new AbortController();
    listRequest = request;
    try {
        const result = await dashboardRequest<{ clients: ClientInfo[] }>('/api/v1/clients', { signal: request.signal });
        if (!request.signal.aborted) clients.value = result.clients;
    } catch (cause) {
        if (!request.signal.aborted && !busy.value) error.value = (cause as Error).message;
    }
}

async function mutate(operation: Operation, id: string) {
    if (busy.value) return;
    error.value = '';
    notice.value = '';
    busy.value = true;
    try {
        const result = await dashboardRequest<ClientCredentials | undefined>('/api/v1/clients', {
            method: 'POST', body: JSON.stringify({ operation, clientId: id }),
        });
        credentials.value = result ?? null;
        confirmation.value = null;
        if (operation === 'issue') newId.value = '';
        notice.value = operation === 'burn' ? 'Credential burned.' : '';
        await refresh();
    } catch (cause) {
        error.value = (cause as Error).message;
    } finally {
        busy.value = false;
    }
}

async function copyCredential() {
    if (!credentials.value) return;
    try {
        await navigator.clipboard.writeText(JSON.stringify(credentials.value, null, 2));
        notice.value = 'Credentials copied.';
    } catch {
        notice.value = 'Select and copy the client ID and secret below.';
    }
}

onMounted(() => {
    void refresh();
    timer = setInterval(() => { if (!busy.value && !document.hidden) void refresh(); }, 10000);
});
onUnmounted(() => {
    listRequest?.abort();
    clearInterval(timer);
});
</script>

<template>
  <div class="workspace-stack">
    <section class="workspace-panel">
      <h2>Issue credential</h2>
      <form class="workspace-inline" @submit.prevent="mutate('issue', newId)">
        <label>Client ID <input v-model="newId" required autocomplete="off" /></label>
        <button class="workspace-primary" type="submit" :disabled="busy || !!credentials">Issue credential</button>
      </form>
    </section>
    <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="workspace-notice" role="status">{{ notice }}</p>
    <section v-if="credentials" class="workspace-panel" aria-labelledby="issued-heading">
      <h2 id="issued-heading">New credential</h2>
      <p>Copy this secret before closing. It is shown once.</p>
      <div class="workspace-fields">
        <label>Client ID <input :value="credentials.clientId" readonly /></label>
        <label>Secret <input :value="credentials.secret" readonly spellcheck="false" /></label>
      </div>
      <div class="workspace-actions">
        <button type="button" class="workspace-primary" @click="copyCredential">Copy credentials</button>
        <button type="button" @click="credentials = null; notice = ''">Close credential</button>
      </div>
    </section>
    <section v-if="confirmation" class="workspace-panel" aria-labelledby="confirm-heading">
      <h2 id="confirm-heading">{{ confirmation.operation === 'burn' ? 'Burn credential' : 'Reroll credential' }}</h2>
      <p>The current secret for <strong>{{ confirmation.id }}</strong> will stop working immediately. Its active streams will disconnect.</p>
      <div class="workspace-actions">
        <button type="button" class="workspace-danger" :disabled="busy" @click="mutate(confirmation.operation, confirmation.id)">
          {{ confirmation.operation === 'burn' ? 'Burn credential' : 'Reroll credential' }}
        </button>
        <button type="button" :disabled="busy" @click="confirmation = null">Cancel</button>
      </div>
    </section>
    <section class="workspace-panel" aria-labelledby="registered-heading">
      <h2 id="registered-heading">Registered clients</h2>
      <p v-if="!clients">{{ error ? 'Client list unavailable.' : 'Loading clients…' }}</p>
      <p v-else-if="!clients.length">No clients have been registered.</p>
      <div v-else class="workspace-table-scroll" tabindex="0" aria-label="Registered clients table">
        <table class="workspace-table">
          <thead><tr><th>Client ID</th><th>Created</th><th>Last authenticated</th><th>Last rotated</th><th>Streams</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="client in clients" :key="client.clientId">
              <th scope="row">{{ client.clientId }}</th>
              <td>{{ dates.format(client.createdAt) }}</td>
              <td>{{ client.lastAuthenticatedAt ? dates.format(client.lastAuthenticatedAt) : 'Never' }}</td>
              <td>{{ client.rotatedAt ? dates.format(client.rotatedAt) : 'Never' }}</td>
              <td>{{ client.connections }}</td>
              <td><div class="workspace-actions compact">
                <button type="button" :disabled="busy || !!credentials || !!confirmation" :aria-label="`Reroll ${client.clientId}`" @click="confirmation = { operation: 'reroll', id: client.clientId }">Reroll</button>
                <button type="button" :disabled="busy || !!credentials || !!confirmation" :aria-label="`Burn ${client.clientId}`" @click="confirmation = { operation: 'burn', id: client.clientId }">Burn</button>
              </div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
