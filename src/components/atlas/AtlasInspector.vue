<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStore } from '@nanostores/vue';
import { addressKey, atlasSnapshot, selectedAddress, selectedContentId } from '../../lib/dashboard-state';
import { cellLink } from '../../lib/workspace-types';

const snapshot = useStore(atlasSnapshot);
const selectedCellKey = useStore(selectedAddress);
const selectedId = useStore(selectedContentId);
const browserQuery = ref('');

const contentById = computed(() => new Map((snapshot.value?.contents ?? []).map(content => [content.id, content])));
const selectedCell = computed(() => snapshot.value?.cells.find(cell => addressKey(cell.address) === selectedCellKey.value));
const selectedContent = computed(() => selectedId.value ? contentById.value.get(selectedId.value) : undefined);
const placements = computed(() => selectedId.value
    ? snapshot.value?.cells.filter(cell => cell.attachments.some(item => item.id === selectedId.value)) ?? []
    : []);
const selectedAttachment = computed(() => selectedCell.value?.attachments.find(item => item.id === selectedId.value));

const filteredContents = computed(() => {
    const q = browserQuery.value.trim().toLowerCase();
    const list = snapshot.value?.contents ?? [];
    if (!q) return list.slice(0, 30);
    return list.filter(item => item.id.toLowerCase().includes(q) || item.kind.toLowerCase().includes(q)).slice(0, 30);
});

function openPlacement(address: readonly string[]) { selectedAddress.set(addressKey(address)); }
function openContent(id: string) {
    selectedContentId.set(id);
    const first = snapshot.value?.cells.find(cell => cell.attachments.some(item => item.id === id));
    if (first && !selectedCellKey.value) selectedAddress.set(addressKey(first.address));
}
</script>

<template>
  <aside class="panel inspector">
    <div class="panel-heading">
      <span>Inspector</span>
      <a v-if="selectedCell" class="text-button" :href="cellLink(selectedCell.address)">Edit in Cells</a>
    </div>

    <template v-if="selectedCell">
      <div class="section-label">CELL ADDRESS</div>
      <code class="address">{{ selectedCell.address.map(value => value || '*').join(' / ') }}</code>
      <div class="section-label">CELL METADATA</div>
      <pre>{{ JSON.stringify(selectedCell.metadata, null, 2) }}</pre>
      <div class="section-label">ATTACHMENTS · {{ selectedCell.attachments.length }}</div>
      <button v-for="attachment in selectedCell.attachments" :key="attachment.id" class="attachment" :class="{ active: selectedId === attachment.id }" @click="openContent(attachment.id)">
        <span>{{ contentById.get(attachment.id)?.kind ?? 'unknown' }}</span>
        <code>{{ attachment.id }}</code>
      </button>
      <template v-if="selectedAttachment">
        <div class="section-label">ATTACHMENT METADATA</div>
        <pre>{{ JSON.stringify(selectedAttachment.metadata, null, 2) }}</pre>
      </template>
    </template>
    <div v-else class="empty-state">Select a cell, cluster, or content identity below to inspect its spatial address, metadata, and shared placements.</div>

    <template v-if="selectedContent">
      <div class="divider"></div>
      <div class="panel-heading" style="margin-bottom:8px">
        <span>Content · {{ selectedContent.kind }}</span>
        <a class="text-button" :href="`/content?id=${encodeURIComponent(selectedContent.id)}`">Edit in Content</a>
      </div>
      <code class="address">{{ selectedContent.id }}</code>
      <div class="section-label">SHARED PAYLOAD</div>
      <pre>{{ JSON.stringify(selectedContent.payload, null, 2) }}</pre>
      <div class="section-label">ALL PLACEMENTS · {{ placements.length }}</div>
      <button v-for="cell in placements" :key="addressKey(cell.address)" class="attachment" :class="{ active: selectedCellKey === addressKey(cell.address) }" @click="openPlacement(cell.address)">
        <span>JUMP TO PLACEMENT</span>
        <code>{{ cell.address.map(value => value || '*').join(' / ') }}</code>
      </button>
    </template>

    <div class="divider"></div>
    <div class="panel-heading" style="margin-bottom:8px"><span>Content browser</span><span>{{ snapshot?.contents.length ?? 0 }}</span></div>
    <input v-model="browserQuery" type="search" placeholder="Filter by ID or kind…" style="margin-bottom:8px" />
    <div class="browser-list">
      <button v-for="item in filteredContents" :key="item.id" class="attachment" :class="{ active: selectedId === item.id }" @click="openContent(item.id)">
        <span>{{ item.kind }}</span>
        <code>{{ item.id }}</code>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.browser-list { max-height: 240px; overflow-y: auto; }
</style>
