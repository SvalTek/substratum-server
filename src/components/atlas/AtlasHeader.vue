<script setup lang="ts">
import { useStore } from '@nanostores/vue';
import { atlasConnection } from '../../lib/dashboard-state';

defineProps<{ notice: string }>();
defineEmits<{ refresh: [] }>();
const connection = useStore(atlasConnection);
</script>

<template>
  <header class="topbar">
    <div class="page-heading"><span>LIVE VIEW / ATLAS</span><strong>Spatial inspector</strong></div>
    <p class="snapshot-status">{{ notice }}</p>
    <div class="top-actions"><span class="live-indicator" :class="connection"><i></i>{{ connection === 'live' ? 'LIVE' : connection === 'loading' ? 'CONNECTING' : 'RECONNECTING' }}</span><button class="quiet" @click="$emit('refresh')">Resync</button></div>
  </header>
</template>
