<script setup lang="ts">
import { Z_INDEX } from '@/constants/Layers';
import { formatCountdown } from '@/utils/formatters';

defineProps<{ ms: number }>();
</script>

<template>
  <div
    class="absolute top-28 md:top-14 left-1/2 -translate-x-1/2 pointer-events-none flex items-center gap-1.5 px-3 py-1 rounded-full text-md font-medium backdrop-blur-md"
    :class="[
      Z_INDEX.TOAST,
      ms <= 0
        ? 'route-pill-expired'
        : ms < 30 * 60 * 1000
          ? 'route-pill-red'
          : ms < 60 * 60 * 1000
            ? 'route-pill-orange'
            : 'route-pill-blue'
    ]"
  >
    <span>⏱</span>
    <span v-if="ms > 0">Route open for: <b>{{ ms <= 0 ? 'Expired' : formatCountdown(ms) }}</b></span>
    <span v-else class="font-bold">Route expired!</span>
  </div>
</template>

<style scoped>
@keyframes route-pill-pulse-orange {
  0%, 100% {
    background: rgba(172, 105, 0, 0.7);
    border-color: #f59e0b;
  }
  50% {
    background: rgba(172, 105, 0, 0.4);
    border-color: rgba(245, 158, 11, 0.5);
  }
}

@keyframes route-pill-pulse-red {
  0%, 100% {
    background: rgba(163, 0, 0, 0.5);
    border-color: #ef4444;
  }
  50% {
    background: rgba(163, 0, 0, 0.4);
    border-color: rgba(239, 68, 68, 0.4);
  }
}
</style>
