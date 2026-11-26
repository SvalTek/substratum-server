<script setup lang="ts">
import { computed, ref } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: string;
  label?: string;
  rows?: number;
  readonly?: boolean;
}>(), {
  label: 'JSON',
  rows: 8,
  readonly: false,
});

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const copied = ref(false);

const parseError = computed(() => {
  const text = props.modelValue.trim();
  if (!text) return 'JSON cannot be empty.';
  try {
    JSON.parse(text);
    return '';
  } catch (cause) {
    return cause instanceof Error ? cause.message : 'Invalid JSON';
  }
});

function formatJson() {
  try {
    emit('update:modelValue', JSON.stringify(JSON.parse(props.modelValue), null, 2));
  } catch { /* Keep current text while invalid */ }
}

function compactJson() {
  try {
    emit('update:modelValue', JSON.stringify(JSON.parse(props.modelValue)));
  } catch { /* Keep current text while invalid */ }
}

async function copyJson() {
  try {
    await navigator.clipboard.writeText(props.modelValue);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1400);
  } catch { /* Clipboard optional */ }
}
</script>

<template>
  <div class="json-editor">
    <div class="json-editor-bar">
      <span class="json-editor-label">{{ label }}</span>
      <span class="json-status" :class="{ invalid: !!parseError }">{{ parseError ? 'Invalid JSON' : 'Valid JSON' }}</span>
      <div class="json-editor-tools">
        <button v-if="!readonly" type="button" :disabled="!!parseError" @click="formatJson">Format</button>
        <button v-if="!readonly" type="button" :disabled="!!parseError" @click="compactJson">Minify</button>
        <button type="button" @click="copyJson">{{ copied ? 'Copied' : 'Copy' }}</button>
      </div>
    </div>
    <textarea
      :value="modelValue"
      :rows="rows"
      :readonly="readonly"
      spellcheck="false"
      class="monospace"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    ></textarea>
    <p v-if="parseError" class="json-error" role="alert">{{ parseError }}</p>
  </div>
</template>

<style scoped>
.json-editor { display: grid; gap: 6px; }
.json-editor-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.json-editor-label { font-size: 12px; font-weight: 500; color: var(--text-secondary); }
.json-status {
  font: 600 10px var(--font-mono);
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--teal-soft);
  color: var(--teal);
}
.json-status.invalid { background: var(--danger-soft); color: var(--danger); }
.json-editor-tools { display: flex; gap: 5px; margin-left: auto; }
.json-editor-tools button { padding: 3px 8px; font-size: 11px; }
.json-error { margin: 0; font-size: 11px; color: var(--danger); font-family: var(--font-mono); }
</style>
