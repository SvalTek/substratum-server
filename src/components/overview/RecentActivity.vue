<script setup lang="ts">
import { useStore } from '@nanostores/vue';
import { overviewStats } from '../../lib/overview/state';

const stats = useStore(overviewStats);
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });
</script>

<template>
  <section class="overview-panel" aria-labelledby="activity-heading">
    <div class="overview-panel-heading">
      <h2 id="activity-heading">Recent activity</h2>
      <a class="overview-link" href="/events">Open event feed</a>
    </div>
    <ol v-if="stats?.recent.length" class="overview-activity">
      <li v-for="{ id, time, name, category, kind } in stats.recent" :key="id">
        <span>
          <strong>{{ name }}</strong>
          <template v-if="kind"> · {{ kind }}</template>
          <small class="activity-cat"> ({{ category }})</small>
        </span>
        <time :datetime="new Date(time).toISOString()">{{ timeFormat.format(time) }}</time>
      </li>
    </ol>
    <p v-else class="overview-empty">{{ stats ? 'No activity recorded yet.' : 'Waiting for activity…' }}</p>
  </section>
</template>

<style scoped>
.activity-cat { color: var(--text-muted); font-size: 11px; }
</style>
