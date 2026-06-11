<script setup lang="ts">
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent, TooltipPortal } from 'reka-ui';
import { Z_INDEX } from '@/constants/Layers';

const emit = defineEmits<{ dismiss: [] }>();
</script>

<template>
  <div class="pointer-events-auto">
    <div class="bg-blue-600 text-white text-xs px-2 py-1 rounded shadow-lg flex items-center gap-1 whitespace-nowrap relative animate-bounce-tooltip">
      <!-- Arrow pointing left toward the handle -->
      <div class="absolute -translate-x-3.5 w-2 h-6 bg-blue-600 [clip-path:polygon(0%_50%,100%_0%,100%_100%)]"></div>
      <span>Link Zone portals!</span>
      <TooltipProvider :delay-duration="0">
        <TooltipRoot>
          <TooltipTrigger asChild>
            <span class="how-trigger underline cursor-help text-blue-200 hover:text-white">(How?)</span>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent
              class="bg-gray-900 border border-gray-600 text-white text-xs px-3 py-2 rounded shadow-xl z-[10000] max-w-[280px]"
              :side-offset="6"
            >
              To link Portals, click and drag from the portal you just connected, and then drag it over to the destination portal.<br><br>You will need to travel through the portal to know where it lands first. You may need to rotate the destination zone to make it match.
            </TooltipContent>
          </TooltipPortal>
        </TooltipRoot>
      </TooltipProvider>
      <button
        class="dismiss-btn ml-1 text-blue-200 hover:text-white leading-none"
        title="Dismiss"
        @click.stop="emit('dismiss')"
        @mousedown.stop
      >✕</button>
    </div>
  </div>
</template>

<style scoped>
@keyframes bounce-tooltip {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
.animate-bounce-tooltip {
  animation: bounce-tooltip 2s infinite;
}
.animate-bounce-tooltip:has(.how-trigger:hover),
.animate-bounce-tooltip:has(.dismiss-btn:hover) {
  animation-play-state: paused;
}

</style>
