<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { dashboardRequest } from '../../lib/dashboard-api';
import type { ActivityEvent } from '../../lib/activity/types';

interface Measurement { samples: number; p50: number | null; p95: number | null; avg: number | null }
interface Diagnostics {
    memory: { rss: number; heapUsed: number; heapTotal: number };
    cpu: { userMicros: number; systemMicros: number; averagePercent: number };
    uptimeSeconds: number;
    runtime: Record<string, number>;
    clients: { registered: number; activeStreams: number };
    performance: { queries: Measurement; mutations: Measurement; recentEvents: number; throughputSeries: number[] };
    errors: ActivityEvent[];
}

const data = ref<Diagnostics | null>(null);
const filter = ref('');
const error = ref('');
let timer: ReturnType<typeof setInterval> | undefined;
let request: AbortController | undefined;

const mib = (value: number) => `${(value / 1048576).toFixed(1)} MiB`;
const duration = (value: number | null) => value === null ? 'No samples' : `${value.toFixed(2)} ms`;
const runtime = computed(() => data.value ? [
    ['Spatial partitions', data.value.runtime.partitions],
    ['Semantic index buckets', data.value.runtime.semanticBuckets],
    ['Cached queries', data.value.runtime.cachedQueries],
    ['Runtime subscriptions', data.value.runtime.subscriptions],
    ['Region-scoped subscriptions', data.value.runtime.scopedSubscriptions],
    ['Active SSE client streams', data.value.clients.activeStreams],
] : []);

const filteredErrors = computed(() => {
    const q = filter.value.trim().toLowerCase();
    return (data.value?.errors ?? []).filter(item =>
        !q || item.name.toLowerCase().includes(q) || (item.source ?? '').toLowerCase().includes(q),
    );
});

async function load() {
    request?.abort();
    const attempt = new AbortController();
    request = attempt;
    try {
        const result = await dashboardRequest<Diagnostics>('/api/v1/operator/diagnostics', { signal: attempt.signal });
        if (!attempt.signal.aborted) { data.value = result; error.value = ''; }
    } catch (cause) {
        if (!attempt.signal.aborted) error.value = (cause as Error).message;
    }
}
onMounted(() => {
    void load();
    timer = setInterval(() => { if (!document.hidden) void load(); }, 5000);
});
onUnmounted(() => { clearInterval(timer); request?.abort(); });
</script>

<template>
  <div class="workspace-stack">
    <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>
    <p v-if="!data">Loading process statistics…</p>
    <template v-else>
      <section class="workspace-panel">
        <div class="workspace-panel-header">
          <h2>Process and performance</h2>
          <button @click="load">Refresh</button>
        </div>
        <dl class="diagnostic-metrics">
          <div><dt>Resident memory (RSS)</dt><dd>{{ mib(data.memory.rss) }}</dd></div>
          <div><dt>Heap used / total</dt><dd>{{ mib(data.memory.heapUsed) }} / {{ mib(data.memory.heapTotal) }}</dd></div>
          <div><dt>CPU average since start</dt><dd>{{ data.cpu.averagePercent.toFixed(2) }}%</dd></div>
          <div><dt>Events (last 60s)</dt><dd>{{ data.performance.recentEvents }}</dd></div>
          <div><dt>Query p50 / p95 ({{ data.performance.queries.samples }})</dt><dd>{{ duration(data.performance.queries.p50) }} · {{ duration(data.performance.queries.p95) }}</dd></div>
          <div><dt>Mutation p50 / p95 ({{ data.performance.mutations.samples }})</dt><dd>{{ duration(data.performance.mutations.p50) }} · {{ duration(data.performance.mutations.p95) }}</dd></div>
        </dl>
      </section>

      <section class="workspace-panel">
        <h2>Indexes and subscriptions</h2>
        <dl class="diagnostic-metrics">
          <div v-for="[label, count] in runtime" :key="label"><dt>{{ label }}</dt><dd>{{ count }}</dd></div>
        </dl>
      </section>

      <section class="workspace-panel">
        <div class="workspace-panel-header">
          <h2>Server &amp; plugin diagnostics</h2>
          <input v-model="filter" type="search" placeholder="Filter by event or source…" style="max-width:240px" />
        </div>
        <p v-if="!filteredErrors.length">No diagnostic records match the current filter.</p>
        <div v-else class="workspace-stack">
          <details v-for="event in filteredErrors" :key="event.id">
            <summary>
              <span class="badge" :class="event.level === 'error' ? 'err' : 'warn'">{{ event.level ?? 'info' }}</span>
              {{ new Date(event.time).toLocaleString() }} · <strong>{{ event.name }}</strong>
              <code v-if="event.source"> ({{ event.source }})</code>
            </summary>
            <pre>{{ JSON.stringify(event.data, null, 2) }}</pre>
          </details>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.diagnostic-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 16px; }
.diagnostic-metrics dt { font-size: 12px; color: var(--text-secondary); }
.diagnostic-metrics dd { margin: 5px 0 0; font-size: 18px; font-weight: 650; font-variant-numeric: tabular-nums; }
</style>
