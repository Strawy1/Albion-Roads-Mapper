<script setup lang="ts">
import { Z_INDEX } from '@/constants/Layers';
import TipButton from '../TipButton.vue';

const emit = defineEmits<{ tipped: [] }>();
</script>

<template>
  <div
    class="bottom-left-toolbar fixed bottom-16 md:bottom-[4.5rem] left-2 md:left-4 flex flex-col items-start gap-2"
    :class="Z_INDEX.UI_OVERLAY"
  >
    <!-- Discord button (matches landing page styling) -->
    <a
      href="https://discord.gg/uFq2PJuZ3r"
      target="_blank"
      class="px-4 py-2 rounded-lg bg-[#5865F2] hover:bg-indigo-500 border border-transparent hover:border hover:border-blue-300 font-medium text-sm transition-colors text-center duration-500 text-white shadow-lg background-blur-md flex items-center gap-2"
    >
      <img src="/images/discord.png" alt="Discord" class="h-5 w-auto" />
      Discord
    </a>

    <!-- Ko-fi / Donations button -->
    <TipButton @clicked="emit('tipped')" />
  </div>
</template>

<style scoped>
/* Small phones: push toolbar up to match previous TipButton behaviour */
@media (max-width: 560px) {
  .bottom-left-toolbar {
    bottom: 5.5rem;
  }
}
</style>
