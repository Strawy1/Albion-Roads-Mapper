<script setup lang="ts">
import {
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
  TooltipPortal,
} from 'reka-ui';
import { useRoomMemoryStore } from '../../stores/useRoomMemoryStore.js';
import { useRoomStore } from '../../stores/useRoomStore.js';
import { computed } from 'vue';

const props = defineProps<{
  zoneId: string;
}>();

const memoryStore = useRoomMemoryStore();
const store = useRoomStore();

const memoryEntry = computed(() => memoryStore.getEntry(props.zoneId));
const isHomeZone = computed(() => props.zoneId === store.homeZoneId);

function formatLastSeen(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
</script>

<template>
  <TooltipProvider v-if="memoryEntry || isHomeZone" :delay-duration="300">
    <TooltipRoot>
      <TooltipTrigger asChild>
        <img v-if="isHomeZone" src="/images/hideout.png" class="shrink-0 w-5 h-5 object-contain cursor-default" />
        <span v-else class="shrink-0 text-yellow-300 text-xs cursor-default">⏳</span>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent class="bg-black text-white text-xs px-2 py-1 rounded shadow-lg z-[10000]">
          <template v-if="isHomeZone">Your hideout zone</template>
          <template v-else>Last seen: {{ formatLastSeen(memoryEntry!.timesAdded[memoryEntry!.timesAdded.length - 1]) }}</template>
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
