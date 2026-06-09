<script setup lang="ts">
import RoomSettings from '../RoomSettings.vue';
import { Z_INDEX } from '@/constants/Layers';

defineProps<{
  roomTitle?: string;
}>();

const emit = defineEmits<{
  (e: 'logout'): void;
  (e: 'fitView'): void;
}>();
</script>

<template>
  <!-- Logo + room title, top-left -->
  <div :class="['absolute top-2 md:top-3 left-4 md:left-6 flex items-center gap-3 pr-16 md:pr-0', Z_INDEX.OVERLAY]">
    <img src="/images/favicon/android-icon-192x192.png" class="w-10 h-10 cursor-pointer shrink-0" alt="Site Logo" @click="emit('logout')" />
    <h1 v-if="roomTitle" class="text-xl font-bold text-gray-200 truncate leading-none px-4 py-2 rounded-full frosted-pill" :title="roomTitle" data-testid="room-title">
      {{ roomTitle }}
    </h1>
  </div>

  <!-- Settings cog at top-right -->
  <div :class="['absolute top-2 right-2', Z_INDEX.OVERLAY]">
    <RoomSettings :tray="true" />
  </div>
</template>

<style scoped>
</style>
