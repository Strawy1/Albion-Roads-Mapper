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
  <span class="truncate flex-1">{{ zone.name }}</span>
  <TagExtras :zone-id="zone.id" />
  <TagZone :type="zone.type" :category="zone.category" :map-shape="zone.mapShape" :zone-name="zone.name" :proximity-to="zone.proximityTo" />
  <TagTier :tier="zone.tier" :type="zone.type" />
</template>
