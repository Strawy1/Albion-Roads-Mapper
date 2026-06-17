<script setup lang="ts">
import { ZoneType } from 'shared';
import TagZone from '../../common/TagZone.vue';
import TagTier from '../../common/TagTier.vue';

const props = defineProps<{
  zoneName?: string;
  id: string;
  isChainSource?: boolean;
  type: ZoneType;
  category?: string;
  mapShape?: string;
  tier?: number;
  compact?: boolean;
  /**
   * Render the chain-source hideout icon closer to the label.
   * Useful when the parent node is smaller (e.g. the 200x200 non-roads diamond)
   * so the icon doesn't float far above the visible shape.
   */
  iconCompact?: boolean;
  proximityTo?: string;
}>();
void props;
</script>

<template>
  <div class="flex flex-col items-center justify-center relative">
    <!-- For roads (non-compact) keep the icon above the title; swap to a house icon -->
    <svg
      v-if="isChainSource && !iconCompact"
      class="absolute w-8 h-10 -top-12 text-white"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 3.172 2.25 11.25h2.25v8.25a1.5 1.5 0 0 0 1.5 1.5h3.75v-6h4.5v6h3.75a1.5 1.5 0 0 0 1.5-1.5v-8.25h2.25L12 3.172Z" />
    </svg>
    <div 
      class="font-bold flex items-center leading-tight mb-1 text-lg"
    >
      {{ zoneName || id }}
    </div>
    <div class="flex items-center gap-1.5" :class="{ 'scale-75 origin-top': compact }">
      <TagTier v-if="tier" :tier="tier" :type="type" />
      <TagZone :type="type" :category="category" :map-shape="mapShape" :proximity-to="proximityTo" :zone-name="zoneName" />
    </div>
    <!-- For non-roads (compact) zones, render the home icon below the tier/zone tags -->
    <svg
      v-if="isChainSource && iconCompact"
      class="mt-1 w-6 h-6 text-white"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 3.172 2.25 11.25h2.25v8.25a1.5 1.5 0 0 0 1.5 1.5h3.75v-6h4.5v6h3.75a1.5 1.5 0 0 0 1.5-1.5v-8.25h2.25L12 3.172Z" />
    </svg>
  </div>
</template>
m