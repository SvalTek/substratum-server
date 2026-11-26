<script setup lang="ts">
import { reactive, watch } from 'vue';
import type { RegionMode } from '../workspace/RegionFields.vue';

const props = withDefaults(defineProps<{
  mode: RegionMode;
  modelValue: string;
  allowAll?: boolean;
}>(), {
  allowAll: false,
});

const emit = defineEmits<{
  'update:mode': [mode: RegionMode];
  'update:modelValue': [value: string];
}>();

const address = reactive({ x: '', y: '', z: '' });
const box = reactive({ x: 0, y: 0, z: 0, ex: 4, ey: 4, ez: 4 });
const bounds = reactive({ x0: -4, x1: 4, y0: 0, y1: 4, z0: -4, z1: 4 });

function syncFromValue() {
  try {
    const parsed = JSON.parse(props.modelValue);
    if (Array.isArray(parsed) && parsed.length === 3) {
      if (typeof parsed[0] === 'string') {
        address.x = parsed[0]; address.y = parsed[1]; address.z = parsed[2];
      } else if (Array.isArray(parsed[0])) {
        bounds.x0 = parsed[0][0]; bounds.x1 = parsed[0][1];
        bounds.y0 = parsed[1][0]; bounds.y1 = parsed[1][1];
        bounds.z0 = parsed[2][0]; bounds.z1 = parsed[2][1];
      }
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.at)) {
      box.x = parsed.at[0] ?? 0; box.y = parsed.at[1] ?? 0; box.z = parsed.at[2] ?? 0;
      const ext = Array.isArray(parsed.extent) ? parsed.extent : [parsed.extent ?? 1, parsed.extent ?? 1, parsed.extent ?? 1];
      box.ex = ext[0] ?? 1; box.ey = ext[1] ?? 1; box.ez = ext[2] ?? 1;
    }
  } catch { /* Allow manual text edits */ }
}

watch(() => props.modelValue, syncFromValue, { immediate: true });

function changeMode(next: RegionMode) {
  emit('update:mode', next);
  if (next === 'all') emit('update:modelValue', '');
  else if (next === 'address') emit('update:modelValue', JSON.stringify([address.x, address.y, address.z]));
  else if (next === 'box') emit('update:modelValue', JSON.stringify({ at: [box.x, box.y, box.z], extent: [box.ex, box.ey, box.ez] }));
  else emit('update:modelValue', JSON.stringify([[bounds.x0, bounds.x1], [bounds.y0, bounds.y1], [bounds.z0, bounds.z1]]));
}

function updateAddress() {
  emit('update:modelValue', JSON.stringify([address.x.trim(), address.y.trim(), address.z.trim()]));
}
function updateBox() {
  emit('update:modelValue', JSON.stringify({ at: [box.x, box.y, box.z], extent: [box.ex, box.ey, box.ez] }));
}
function updateBounds() {
  emit('update:modelValue', JSON.stringify([[bounds.x0, bounds.x1], [bounds.y0, bounds.y1], [bounds.z0, bounds.z1]]));
}
</script>

<template>
  <div class="address-builder">
    <div class="address-tabs" role="tablist" aria-label="Region input mode">
      <button v-if="allowAll" type="button" role="tab" :aria-selected="mode === 'all'" :class="{ active: mode === 'all' }" @click="changeMode('all')">All space</button>
      <button type="button" role="tab" :aria-selected="mode === 'address'" :class="{ active: mode === 'address' }" @click="changeMode('address')">Binary prefix</button>
      <button type="button" role="tab" :aria-selected="mode === 'box'" :class="{ active: mode === 'box' }" @click="changeMode('box')">Box &amp; extent</button>
      <button type="button" role="tab" :aria-selected="mode === 'bounds'" :class="{ active: mode === 'bounds' }" @click="changeMode('bounds')">Bounds</button>
    </div>

    <div v-if="mode === 'address'" class="builder-grid three">
      <label>X prefix <input v-model="address.x" class="monospace" placeholder="* (empty)" @input="updateAddress" /></label>
      <label>Y prefix <input v-model="address.y" class="monospace" placeholder="* (empty)" @input="updateAddress" /></label>
      <label>Z prefix <input v-model="address.z" class="monospace" placeholder="* (empty)" @input="updateAddress" /></label>
    </div>

    <div v-else-if="mode === 'box'" class="builder-grid six">
      <label>At X <input v-model.number="box.x" type="number" step="1" @input="updateBox" /></label>
      <label>At Y <input v-model.number="box.y" type="number" step="1" @input="updateBox" /></label>
      <label>At Z <input v-model.number="box.z" type="number" step="1" @input="updateBox" /></label>
      <label>Extent X <input v-model.number="box.ex" type="number" min="1" step="1" @input="updateBox" /></label>
      <label>Extent Y <input v-model.number="box.ey" type="number" min="1" step="1" @input="updateBox" /></label>
      <label>Extent Z <input v-model.number="box.ez" type="number" min="1" step="1" @input="updateBox" /></label>
    </div>

    <div v-else-if="mode === 'bounds'" class="builder-grid six">
      <label>X min <input v-model.number="bounds.x0" type="number" step="1" @input="updateBounds" /></label>
      <label>X max <input v-model.number="bounds.x1" type="number" step="1" @input="updateBounds" /></label>
      <label>Y min <input v-model.number="bounds.y0" type="number" step="1" @input="updateBounds" /></label>
      <label>Y max <input v-model.number="bounds.y1" type="number" step="1" @input="updateBounds" /></label>
      <label>Z min <input v-model.number="bounds.z0" type="number" step="1" @input="updateBounds" /></label>
      <label>Z max <input v-model.number="bounds.z1" type="number" step="1" @input="updateBounds" /></label>
    </div>
  </div>
</template>

<style scoped>
.address-builder { display: grid; gap: 10px; }
.address-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.address-tabs button { padding: 5px 10px; font-size: 12px; }
.address-tabs button.active { background: var(--accent-soft); border-color: var(--accent); color: #f1eeff; }
.builder-grid { display: grid; gap: 8px; }
.builder-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.builder-grid.six { grid-template-columns: repeat(auto-fit, minmax(95px, 1fr)); }
@media (max-width: 600px) { .builder-grid.three { grid-template-columns: 1fr; } }
</style>
