<script setup lang="ts">
import { computed } from 'vue';
import { Z_INDEX } from '@/constants/Layers';

const props = defineProps<{
  pointing?: 'up' | 'down' | 'left' | 'right';
  offsetX?: number;
  offsetY?: number;
  bounce?: boolean;
  target?: HTMLElement;
}>();

const tooltipStyle = computed(() => {
  const x = props.offsetX || 0;
  const y = props.offsetY || 0;

  if (props.target) {
    const rect = props.target.getBoundingClientRect();
    return {
      position: 'fixed' as const,
      left: props.pointing === 'left'
        ? `${rect.right + 10 + x}px`
        : props.pointing === 'right'
        ? `${rect.left - 10 + x}px`
        : `${rect.left + rect.width / 2 + x}px`,
      top: props.pointing === 'down'
        ? `${rect.top - 10 + y}px`
        : props.pointing === 'up'
        ? `${rect.bottom + 10 + y}px`
        : `${rect.top + rect.height / 2 + y}px`,
      transform: props.pointing === 'down'
        ? 'translateX(-50%) translateY(-100%)'
        : props.pointing === 'up'
        ? 'translateX(-50%)'
        : props.pointing === 'left'
        ? 'translateY(-50%)'
        : 'translateX(-100%) translateY(-50%)',
    };
  }

  return {};
});
</script>

<template>
  <div
    :class="[Z_INDEX.UI_OVERLAY, { 'absolute': !target }]"
    :style="tooltipStyle"
  >
    <div
      class="relative bg-blue-600 text-white text-center text-xs px-2 py-1 rounded shadow-lg"
      :class="{ 'animate-bounce-prompt': bounce }"
    >
      <div class="flex items-center gap-1 whitespace-nowrap">
        <slot />
        <slot name="actions" />
      </div>
      <!-- Arrows -->
      <div v-if="pointing === 'down'" class="absolute -bottom-1.5 left-1/2 w-4 h-2 bg-blue-600 [clip-path:polygon(0%_0%,100%_0%,50%_100%)] -translate-x-1/2"></div>
      <div v-if="pointing === 'up'" class="absolute -top-1.5 left-1/2 w-4 h-2 bg-blue-600 [clip-path:polygon(50%_0%,0%_100%,100%_100%)] -translate-x-1/2"></div>
      <div v-if="pointing === 'left'" class="absolute -left-1.5 top-1/2 w-2 h-4 bg-blue-600 [clip-path:polygon(0%_50%,100%_0%,100%_100%)] -translate-y-1/2"></div>
      <div v-if="pointing === 'right'" class="absolute -right-1.5 top-1/2 w-2 h-4 bg-blue-600 [clip-path:polygon(0%_0%,100%_50%,0%_100%)] -translate-y-1/2"></div>
    </div>
  </div>
</template>

<style scoped>
@keyframes bounce-prompt {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}
.animate-bounce-prompt {
  animation: bounce-prompt 2s infinite;
}
.animate-bounce-prompt:hover,
.animate-bounce-prompt:has(button:hover),
.animate-bounce-prompt:has(a:hover) {
  animation-play-state: paused;
}
</style>
