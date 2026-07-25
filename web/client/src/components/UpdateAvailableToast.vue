<script setup lang="ts">
import { Z_INDEX } from '@/constants/Layers';

defineProps<{ show: boolean }>();
defineEmits<{ reload: [] }>();
</script>

<template>
  <!-- Persistent (never auto-dismissed) prompt shown app-wide when a newer
       client build is available. Sits at the same vertical position as the mega
       toast in RoomView, and the full-width wrapper is click-through so it never
       blocks the map underneath. Centred with flex rather than -translate-x-1/2
       so the enter/leave animation can own `transform` without conflict. -->
  <Transition name="update-toast">
    <div
      v-if="show"
      class="fixed top-20 md:top-24 left-0 right-0 flex justify-center px-4 pointer-events-none"
      :class="Z_INDEX.TOAST"
    >
      <div
        class="pointer-events-auto flex items-center gap-3 rounded-lg border border-indigo-500 bg-gray-800 px-4 py-2 text-sm text-white shadow-lg"
        role="status"
      >
        <span>A new version has been released, please reload</span>
        <button
          class="rounded bg-indigo-600 px-3 py-1 font-medium text-white transition-colors hover:bg-indigo-500"
          @click="$emit('reload')"
        >
          Reload
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Mirrors the ping-toast motion used by MegaToast so this feels native. */
.update-toast-enter-active {
  animation: update-toast-in 0.3s ease-out forwards;
}
.update-toast-leave-active {
  animation: update-toast-out 0.4s ease-in forwards;
}

@keyframes update-toast-in {
  0% { transform: translateY(-20px) scale(0.8); opacity: 0; }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}
@keyframes update-toast-out {
  0% { transform: translateY(0) scale(1); opacity: 1; }
  100% { transform: translateY(-20px) scale(0.8); opacity: 0; }
}
</style>
