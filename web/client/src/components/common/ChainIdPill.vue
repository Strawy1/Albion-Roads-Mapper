<script setup lang="ts">
import { computed } from 'vue';
import {
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
  TooltipPortal,
} from 'reka-ui';
import { useRoomStore } from '@/stores/useRoomStore';
import { Z_INDEX } from '@/constants/Layers';

const props = withDefaults(defineProps<{
  zoneId: string;
  /**
   * When provided, the pill is absolutely positioned using these inline styles
   * (used by the node components which anchor it above the node).
   * When omitted, the pill renders inline (used next to the home/house icon
   * in tooltips, search results, etc.).
   */
  positionStyle?: Record<string, string> | string;
  /** Smaller variant for inline usage next to icons. */
  small?: boolean;
}>(), {
  positionStyle: () => ({}),
  small: false,
});

const store = useRoomStore();

// Combine the optional absolute-positioning style with the colour-driven
// border/text colour so the pill reflects the chain's chosen colour.
const pillStyle = computed<Record<string, string>>(() => {
  const base: Record<string, string> =
    typeof props.positionStyle === 'string'
      ? {}
      : { ...(props.positionStyle ?? {}) };
  // Strip any caller-provided z-index — z-layering is owned by Layers.ts via
  // the CHAIN_ID_PILL class so the pill consistently sits above the overlay.
  delete base.zIndex;
  delete (base as Record<string, string>)['z-index'];
  const colour = store.chainColorForZone(props.zoneId);
  if (colour) {
    base.color = colour;
    base.borderColor = colour;
  }
  return base;
});
</script>

<template>
  <TooltipProvider :delay-duration="0" v-if="store.chainFriendlyIdForZone(props.zoneId) !== null">
    <TooltipRoot>
      <TooltipTrigger asChild>
        <div
          :class="[
            'chain-id-pill rounded-full bg-gray-900/90 border font-bold flex items-center gap-1 shadow whitespace-nowrap cursor-pointer hover:bg-gray-800/95 transition-colors',
            Z_INDEX.CHAIN_ID_PILL,
            props.positionStyle && typeof props.positionStyle !== 'string' && Object.keys(props.positionStyle).length ? 'absolute left-1/2 -translate-x-1/2' : 'inline-flex',
            props.small ? 'px-1.5 py-0.5 text-[10px] mt-0.5' : 'px-2 py-0.5 text-sm',
          ]"
          :style="pillStyle"
          @click.stop="store.openChainManagement()"
          @mousedown.stop
        >
          <span aria-hidden="true">⛓</span>
          <span>{{ store.chainFriendlyIdForZone(props.zoneId) }}</span>
        </div>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent class="bg-black text-white text-xs px-2 py-1 rounded shadow-lg z-[10000]">
          {{ store.chainTooltipForZone(props.zoneId) }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
