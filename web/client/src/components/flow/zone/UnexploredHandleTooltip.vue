<script setup lang="ts">
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent, TooltipPortal } from 'reka-ui';
import BluePrompt from '@/components/ui/BluePrompt.vue';
import {Z_INDEX} from "@/constants/Layers";

const emit = defineEmits<{ dismiss: [] }>();
</script>

<template>
  <BluePrompt
    pointing="left"
    class="pointer-events-auto"
    :class="[Z_INDEX.HANDLE_OVERLAY]"
    :offset-y="50"
    :offset-x="50"
  >
    <span>Link Zone portals!</span>
    <template #actions>
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
    </template>
  </BluePrompt>
</template>
