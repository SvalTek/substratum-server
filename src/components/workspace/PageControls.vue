<script setup lang="ts">
defineProps<{ page: number; total: number; limit: number }>();
defineEmits<{ change: [page: number] }>();
</script>

<template>
  <div class="workspace-actions workspace-pages" aria-label="Pagination">
    <button :disabled="page <= 1" @click="$emit('change', page - 1)">Previous</button>
    <span>Page {{ page }} of {{ Math.max(1, Math.ceil(total / limit)) }} · {{ total }} records</span>
    <button :disabled="page * limit >= total" @click="$emit('change', page + 1)">Next</button>
  </div>
</template>
