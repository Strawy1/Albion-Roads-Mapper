<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRafFn } from '@vueuse/core';
import { useVueFlow } from '@vue-flow/core';
import { Z_INDEX } from '@/constants/Layers';
import { useRoomStore } from '@/stores/useRoomStore';

const roomStore = useRoomStore();

const props = defineProps<{
  pointing?: 'up' | 'down' | 'left' | 'right';
  offsetX?: number;
  offsetY?: number;
  bounce?: boolean;
  target?: HTMLElement;
  screenPos?: { x: number; y: number };
}>();

const rect = ref<DOMRect | null>(null);
const { viewport } = useVueFlow();
const zoom = computed(() => viewport.value?.zoom ?? 1);

useRafFn(() => {
  if (props.target) {
    rect.value = props.target.getBoundingClientRect();
  }
});

const tooltipStyle = computed(() => {
  const ox = props.offsetX || 0;
  const oy = props.offsetY || 0;

  let cx: number | null = null;
  let cy: number | null = null;

  if (props.screenPos) {
    cx = props.screenPos.x + ox;
    cy = props.screenPos.y + oy;
  } else if (props.target && rect.value) {
    const r = rect.value;
    cx = props.pointing === 'left'
      ? r.right + 10 + ox
      : props.pointing === 'right'
      ? r.left - 10 + ox
      : r.left + r.width / 2 + ox;
    cy = props.pointing === 'down'
      ? r.top - 10 + oy
      : props.pointing === 'up'
      ? r.bottom + 10 + oy
      : r.top + r.height / 2 + oy;
  }

  if (cx === null || cy === null) return {};

  const z = zoom.value;
  const baseTransform = props.pointing === 'down'
    ? 'translateX(-50%) translateY(-100%)'
    : props.pointing === 'up'
    ? 'translateX(-50%)'
    : props.pointing === 'left'
    ? 'translateY(-50%)'
    : 'translateX(-100%) translateY(-50%)';
  const transformOrigin = props.pointing === 'down'
    ? 'bottom center'
    : props.pointing === 'up'
    ? 'top center'
    : props.pointing === 'left'
    ? 'left center'
    : 'right center';

  return {
    position: 'fixed' as const,
    left: `${cx}px`,
    top: `${cy}px`,
    transform: `${baseTransform} scale(${z * 0.7})`,
    transformOrigin,
  };
});
</script>

<template>
  <Teleport v-if="roomStore.bluePromptsEnabled" to="body" :disabled="!target && !screenPos">
    <div
      :class="[Z_INDEX.UI_OVERLAY, { 'absolute': !target && !screenPos }]"
      :style="tooltipStyle"
    >
      <div
        class="relative bg-blue-600 border-2 border-blue-400 text-white text-center px-3 py-1.5 rounded shadow-lg text-lg"
        :class="[{ 'animate-bounce-prompt': bounce }]"
      >
        <div class="flex items-center gap-1 whitespace-nowrap">
          <slot />
          <slot name="actions" />
        </div>
        <!-- Arrows (with blue-400 outline via layered larger arrow behind) -->
        <template v-if="pointing === 'down'">
          <div class="absolute -bottom-[14px] left-1/2 w-7 h-3.5 bg-blue-400 [clip-path:polygon(0%_0%,100%_0%,50%_100%)] -translate-x-1/2"></div>
          <div class="absolute -bottom-[10px] left-1/2 w-[20px] h-[10px] bg-blue-600 [clip-path:polygon(0%_0%,100%_0%,50%_100%)] -translate-x-1/2"></div>
        </template>
        <template v-if="pointing === 'up'">
          <div class="absolute -top-[14px] left-1/2 w-7 h-3.5 bg-blue-400 [clip-path:polygon(50%_0%,0%_100%,100%_100%)] -translate-x-1/2"></div>
          <div class="absolute -top-[10px] left-1/2 w-[20px] h-[10px] bg-blue-600 [clip-path:polygon(50%_0%,0%_100%,100%_100%)] -translate-x-1/2"></div>
        </template>
        <template v-if="pointing === 'left'">
          <div class="absolute -left-[14px] top-1/2 w-3.5 h-7 bg-blue-400 [clip-path:polygon(0%_50%,100%_0%,100%_100%)] -translate-y-1/2"></div>
          <div class="absolute -left-[10px] top-1/2 w-[10px] h-[20px] bg-blue-600 [clip-path:polygon(0%_50%,100%_0%,100%_100%)] -translate-y-1/2"></div>
        </template>
        <template v-if="pointing === 'right'">
          <div class="absolute -right-[14px] top-1/2 w-3.5 h-7 bg-blue-400 [clip-path:polygon(0%_0%,100%_50%,0%_100%)] -translate-y-1/2"></div>
          <div class="absolute -right-[10px] top-1/2 w-[10px] h-[20px] bg-blue-600 [clip-path:polygon(0%_0%,100%_50%,0%_100%)] -translate-y-1/2"></div>
        </template>
      </div>
    </div>
  </Teleport>
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
