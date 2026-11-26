<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from '@nanostores/vue';
import { atlasSnapshot } from '../../lib/dashboard-state';

const snapshot = useStore(atlasSnapshot);
const stats = computed(() => {
    const data = snapshot.value;
    if (!data) return { cells: 0, attachments: 0, contents: 0, orphans: 0 };
    const placed = new Set<string>();
    let attachments = 0;
    for (const cell of data.cells) for (const item of cell.attachments) { attachments++; placed.add(item.id); }
    return { cells: data.cells.length, attachments, contents: data.contents.length, orphans: data.contents.length - placed.size };
});
</script>

<template>
  <section class="stats-row">
    <div><strong>{{ stats.cells.toLocaleString() }}</strong><span>CELLS</span></div>
    <div><strong>{{ stats.attachments.toLocaleString() }}</strong><span>PLACEMENTS</span></div>
    <div><strong>{{ stats.contents.toLocaleString() }}</strong><span>CONTENT IDS</span></div>
    <div><strong>{{ stats.orphans.toLocaleString() }}</strong><span>ORPHANS</span></div>
  </section>
</template>
