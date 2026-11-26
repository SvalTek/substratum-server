<script setup lang="ts">
import { useStore } from '@nanostores/vue';
import { computed, onMounted, onUnmounted } from 'vue';
import { connectOverview, overviewConnection, overviewError, overviewStats } from '../../lib/overview/state';

const stats = useStore(overviewStats);
const connection = useStore(overviewConnection);
const error = useStore(overviewError);
let disconnect: (() => void) | undefined;
onMounted(() => { disconnect = connectOverview(); });
onUnmounted(() => disconnect?.());

const numbers = new Intl.NumberFormat();
const counts = [
    { label: 'Cells', key: 'cells' },
    { label: 'Attachments', key: 'attachments' },
    { label: 'Content IDs', key: 'contents' },
    { label: 'Orphans', key: 'orphans' },
] as const;

const uptime = computed(() => {
    const seconds = stats.value?.uptimeSeconds ?? 0;
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days) return `${days}d ${hours % 24}h`;
    return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
});

const storageSize = computed(() => {
    const kib = (stats.value?.storage.allocatedBytes ?? 0) / 1024;
    return kib >= 1024 ? `${numbers.format(Number((kib / 1024).toFixed(1)))} MiB` : `${numbers.format(Math.round(kib))} KiB`;
});

const sparkMax = computed(() => Math.max(1, ...(stats.value?.performance.throughputSeries ?? [0])));
</script>

<template>
  <section class="overview-panel runtime-summary" aria-labelledby="runtime-heading">
    <div class="overview-panel-heading">
      <h2 id="runtime-heading">Runtime</h2>
      <span class="overview-connection" :class="{ connected: connection === 'Live' }" role="status">
        <i aria-hidden="true"></i>{{ connection }}
      </span>
    </div>
    <p v-if="error" class="overview-error" role="status">{{ error }}</p>
    <dl class="runtime-details">
      <div>
        <dt>Server version</dt>
        <dd>{{ stats ? `v${stats.version}` : '—' }}</dd>
        <div class="runtime-caption">{{ stats ? `Server uptime ${uptime} · ${stats.bits}-bit space` : 'Waiting for statistics' }}</div>
      </div>
      <div>
        <dt>Storage health</dt>
        <dd>{{ stats ? storageSize : '—' }}</dd>
        <div class="runtime-caption">{{ stats ? `${stats.storage.journal.toUpperCase()} · ${stats.storage.backupCount} backups` : 'Waiting for statistics' }}</div>
      </div>
      <div>
        <dt><a href="/plugins">Plugins</a></dt>
        <dd>{{ stats ? `${stats.pluginSummary.active} / ${stats.pluginSummary.total}` : '—' }}</dd>
        <div class="runtime-caption">
          <template v-if="stats">
            {{ stats.pluginSummary.errored ? `${stats.pluginSummary.errored} errored` : (stats.plugins.join(', ') || 'No plugins loaded') }}
          </template>
          <template v-else>Waiting for statistics</template>
        </div>
      </div>
      <div>
        <dt><a href="/clients">Registered clients</a></dt>
        <dd>{{ stats ? numbers.format(stats.clientCount) : '—' }}</dd>
        <div class="runtime-caption">{{ stats ? `${numbers.format(stats.subscriptions)} active subscriptions` : 'Waiting for statistics' }}</div>
      </div>
    </dl>

    <dl class="runtime-performance">
      <div>
        <dt>Events (last 60s)</dt>
        <dd>{{ stats ? numbers.format(stats.performance.recentEvents) : '—' }}</dd>
      </div>
      <div>
        <dt>Query p95</dt>
        <dd>{{ stats?.performance.queryP95 != null ? `${stats.performance.queryP95.toFixed(2)} ms` : '—' }}</dd>
      </div>
      <div>
        <dt>Mutation p95</dt>
        <dd>{{ stats?.performance.mutationP95 != null ? `${stats.performance.mutationP95.toFixed(2)} ms` : '—' }}</dd>
      </div>
    </dl>

    <div v-if="stats" class="throughput-row">
      <div>
        <div class="runtime-caption">Event throughput (5s buckets · last minute)</div>
      </div>
      <div class="throughput-spark" aria-label="Event throughput over last 60 seconds">
        <span
          v-for="(value, index) in stats.performance.throughputSeries"
          :key="index"
          :title="`${value} events`"
          :style="{ height: `${Math.max(8, Math.round((value / sparkMax) * 100))}%`, opacity: value ? 0.9 : 0.25 }"
        ></span>
      </div>
    </div>

    <dl class="runtime-counts">
      <div v-for="{ label, key } in counts" :key="key">
        <dt>{{ label }}</dt>
        <dd>{{ stats ? numbers.format(stats[key]) : '—' }}</dd>
      </div>
    </dl>
  </section>
</template>
