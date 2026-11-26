<script setup lang="ts">
import { useStore } from '@nanostores/vue';
import { computed } from 'vue';
import { overviewStats } from '../../lib/overview/state';

const stats = useStore(overviewStats);
const numbers = new Intl.NumberFormat();
const other = computed(() => {
    const data = stats.value;
    return data ? data.contents - data.kinds.reduce((sum, item) => sum + item.count, 0) : 0;
});
</script>

<template>
  <section class="overview-panel" aria-labelledby="distribution-heading">
    <div class="overview-panel-heading"><h2 id="distribution-heading">Content by kind</h2></div>
    <ul v-if="stats?.contents" class="kind-list">
      <li v-for="{ kind, count } in stats.kinds" :key="kind">
        <span>{{ kind }}</span><strong>{{ numbers.format(count) }}</strong>
        <meter :value="count" :max="stats.contents" :aria-label="`${kind} share of content`">{{ count }} of {{ stats.contents }}</meter>
      </li>
      <li v-if="other">
        <span>Other kinds</span><strong>{{ numbers.format(other) }}</strong>
        <meter :value="other" :max="stats.contents" aria-label="Other kinds’ share of content">{{ other }} of {{ stats.contents }}</meter>
      </li>
    </ul>
    <p v-else class="overview-empty">{{ stats ? 'No content has been created yet.' : 'Waiting for statistics…' }}</p>
  </section>
</template>
