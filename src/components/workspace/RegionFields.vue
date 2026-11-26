<script setup lang="ts">
export type RegionMode = 'all' | 'address' | 'bounds' | 'box';
const mode = defineModel<RegionMode>('mode', { required: true });
const value = defineModel<string>('value', { required: true });
defineProps<{ allowAll?: boolean }>();
const defaults: Record<RegionMode, string> = {
    all: '',
    address: '["", "", ""]',
    bounds: '[[-16, 15], [0, 15], [-16, 15]]',
    box: '{"at": [0, 0, 0], "extent": [8, 8, 8]}',
};
const labels: Record<RegionMode, string> = {
    all: 'Whole world',
    address: 'X, Y, Z binary prefixes',
    bounds: 'Inclusive X, Y, Z ranges',
    box: 'Coordinates and optional extent',
};
function updateMode(event: Event) {
    mode.value = (event.target as HTMLSelectElement).value as RegionMode;
    value.value = defaults[mode.value];
}
</script>

<template>
  <div class="workspace-fields">
    <label>Region representation
      <select :value="mode" @change="updateMode">
        <option v-if="allowAll" value="all">Whole world</option>
        <option value="address">Binary prefixes</option>
        <option value="bounds">Bounds</option>
        <option value="box">Coordinates and extent</option>
      </select>
    </label>
    <label v-if="mode !== 'all'">{{ labels[mode] }}
      <input v-model="value" class="monospace" required spellcheck="false" :placeholder="defaults[mode]" />
    </label>
  </div>
</template>
