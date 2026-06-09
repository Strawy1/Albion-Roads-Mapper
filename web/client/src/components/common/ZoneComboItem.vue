<script setup lang="ts">
import type { Zone } from 'shared';
import TagExtras from './TagExtras.vue';
import TagZone from './TagZone.vue';
import TagTier from './TagTier.vue';

defineProps<{
  zone: Zone;
}>();
</script>

<template>
  <span class="truncate flex-1 flex items-center gap-1"><img v-if="zone.type === 'roadsHideout'" src="/images/hideout.png" class="shrink-0 w-4 h-4 object-contain" title="Hideout" />{{ zone.name }}</span>
  <TagExtras :zone-id="zone.id" />
  <TagZone :type="zone.type" :category="zone.category" :map-shape="zone.mapShape" :zone-name="zone.name" :proximity-to="zone.proximityTo" />
  <TagTier :tier="zone.tier" :type="zone.type" />
</template>
