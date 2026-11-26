<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';

const props = withDefaults(defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
}>(), {
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  danger: false,
  busy: false,
});

const emit = defineEmits<{ confirm: []; cancel: [] }>();

function onKeydown(event: KeyboardEvent) {
  if (props.open && event.key === 'Escape' && !props.busy) emit('cancel');
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div v-if="open" class="confirm-backdrop" role="presentation" @click.self="!busy && emit('cancel')">
    <div class="confirm-dialog" role="alertdialog" aria-modal="true" :aria-labelledby="'confirm-title'" :aria-describedby="'confirm-desc'">
      <h3 id="confirm-title">{{ title }}</h3>
      <p id="confirm-desc">{{ message }}</p>
      <div class="confirm-actions">
        <button type="button" :disabled="busy" @click="emit('cancel')">{{ cancelLabel }}</button>
        <button type="button" :class="danger ? 'workspace-danger' : 'workspace-primary'" :disabled="busy" @click="emit('confirm')">
          {{ busy ? 'Working…' : confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(5, 8, 15, 0.72);
  backdrop-filter: blur(4px);
}
.confirm-dialog {
  width: min(100%, 440px);
  padding: 22px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}
.confirm-dialog h3 { margin: 0 0 8px; font-size: 16px; color: var(--text-primary); }
.confirm-dialog p { margin: 0 0 18px; font-size: 13px; line-height: 1.55; color: var(--text-secondary); }
.confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
