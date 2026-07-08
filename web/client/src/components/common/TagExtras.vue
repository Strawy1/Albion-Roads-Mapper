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
import ChainIdPill from './ChainIdPill.vue';

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
        <span v-if="isHomeZone" class="inline-flex items-center gap-1 cursor-default">
          <svg
            class="shrink-0 w-5 h-5 object-contain text-white"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 3.172 2.25 11.25h2.25v8.25a1.5 1.5 0 0 0 1.5 1.5h3.75v-6h4.5v6h3.75a1.5 1.5 0 0 0 1.5-1.5v-8.25h2.25L12 3.172Z" />
          </svg>
          <ChainIdPill :zone-id="zoneId" small />
        </span>
        <span v-else class="shrink-0 text-yellow-300 text-xs cursor-default">⏳</span>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent class="bg-black text-white text-xs px-2 py-1 rounded shadow-lg z-[10000]">
          <template v-if="isHomeZone">Your home zone</template>
          <template v-else>Last seen: {{ formatLastSeen(memoryEntry!.timesAdded[memoryEntry!.timesAdded.length - 1]) }}</template>
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
