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
    <img
      v-if="isChainSource"
      src="/images/hideout.png"
      class="absolute w-8 h-10"
      :class="iconCompact ? '-top-9' : '-top-12'"
    />
    <div 
      class="font-bold flex items-center leading-tight mb-1 text-lg"
    >
      {{ zoneName || id }}
    </div>
    <div class="flex items-center gap-1.5" :class="{ 'scale-75 origin-top': compact }">
      <TagTier v-if="tier" :tier="tier" :type="type" />
      <TagZone :type="type" :category="category" :map-shape="mapShape" :proximity-to="proximityTo" :zone-name="zoneName" />
    </div>
  </div>
</template>
m