<script setup lang="ts">
import { GameMapBaselineFeatures, NodeFeatures } from 'shared';
import { Z_INDEX } from '@/constants/Layers';

const props = defineProps<{
  isOpen: boolean;
  hasReds: boolean;
  features?: NodeFeatures;
  baselineFeatures?: GameMapBaselineFeatures;
  zoneTypeLabel?: string | null;
}>();

const emit = defineEmits<{
  (e: 'toggle', feature: 'crystalCreaturePresent'): void;
  (e: 'close'): void;
}>();

// Static data is displayed read-only: it is imported from Albion Maps and is
// the single authoritative source for chests/resources/dungeons. There is no
// edit control for any of it — the modal only manages LIVE observations.
function chestRows(): { label: string; count: number }[] {
  const b = props.baselineFeatures;
  if (!b) return [];
  return [
    { label: 'Green', count: b.chests.green },
    { label: 'Blue', count: b.chests.blue },
    { label: 'Large Gold', count: b.chests.largeGold },
    { label: 'Small Gold', count: b.chests.smallGold },
  ].filter((r) => r.count > 0);
}

function resourceRows(): { label: string }[] {
  const b = props.baselineFeatures;
  if (!b) return [];
  const labels: [keyof typeof b.resources, string][] = [
    ['hide', 'Hide'],
    ['ore', 'Ore'],
    ['fiber', 'Fiber'],
    ['wood', 'Wood'],
    ['stone', 'Stone'],
  ];
  return labels.filter(([key]) => b.resources[key]).map(([, label]) => ({ label }));
}
</script>

<template>
  <Transition name="tray">
    <div v-if="isOpen" 
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] rounded-xl shadow-2xl backdrop-blur-xl border p-4 text-left space-y-3 transition-all duration-300"
      :class="[
        hasReds ? 'bg-red-950/90 border-red-500/50' : 'bg-gray-900/95 border-gray-700',
        Z_INDEX.MODAL
      ]"
      @mousedown.stop
      @click.stop
    >
      <div class="flex items-center justify-between mb-1">
        <div class="text-[10px] uppercase text-white font-bold tracking-widest">Zone Details</div>
        <button
          @click="emit('close')"
          class="zone-button px-2 py-1 flex items-center gap-1.5 transition-colors"
          :class="hasReds ? 'zone-button-reds' : ''"
          title="Close"
        >
          <span class="text-[10px] uppercase text-white font-bold tracking-widest">Close</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <!-- Static zone data — read-only -->
      <div v-if="baselineFeatures" class="rounded-lg border border-blue-500/30 bg-blue-500/5 px-3 py-2 space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-[9px] uppercase text-blue-300 font-bold tracking-wider">Static · Albion Maps</span>
          <span v-if="zoneTypeLabel" class="text-[9px] uppercase text-white/90 font-bold">{{ zoneTypeLabel }}</span>
        </div>
        <div class="flex flex-wrap gap-x-3 gap-y-0.5">
          <span v-for="c in chestRows()" :key="c.label" class="text-[10px] text-gray-200">{{ c.label }} ×{{ c.count }}</span>
          <span v-if="baselineFeatures.dungeon > 0" class="text-[10px] text-gray-200">Dungeon ×{{ baselineFeatures.dungeon }}</span>
          <span v-for="r in resourceRows()" :key="r.label" class="text-[10px] text-gray-200">{{ r.label }}</span>
        </div>
        <div class="text-[8px] text-blue-300/60">Provided by Albion Maps — not editable.</div>
      </div>
      <div v-else class="rounded-lg border border-gray-700/60 bg-gray-800/40 px-3 py-2">
        <span class="text-[9px] uppercase text-gray-400 font-bold tracking-wider">No static data for this zone</span>
      </div>

      <hr class="transition-colors duration-300" :class="hasReds ? 'border-red-500/30' : 'border-gray-700/50'" />

      <!-- Live features -->
      <div>
        <div class="section-label">Live Observations</div>
        <div class="flex flex-wrap gap-2 items-center justify-start">
          <div class="feature-item flex flex-col items-center gap-1 self-center">
            <button
              @click.stop="emit('toggle', 'crystalCreaturePresent')"
              class="zone-button w-8 h-8 flex items-center justify-center rounded p-0.5"
              :class="[hasReds ? 'zone-button-reds' : '', features?.crystalCreaturePresent ? 'ring-1 ring-white bg-gray-500' : 'opacity-60']"
              title="Crystal Creature"
            >
              <img src="/images/crystal.png" alt="Crystal Creature" class="w-full h-full object-cover" />
            </button>
            <span class="col-label my-0.5" style="font-size: 8px">Crystal Creature</span>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.tray-enter-active,
.tray-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.tray-enter-from,
.tray-leave-to {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.9);
}

.section-label {
  @apply text-[9px] uppercase text-white font-bold mb-1.5 tracking-wider;
}

.col-label {
  @apply text-[9px] uppercase text-gray-400 font-bold tracking-wider text-center;
}
</style>
