<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoomStore } from '@/stores/useRoomStore';
import { Z_INDEX } from '@/constants/Layers';
import { formatTime } from '@/utils/formatters';

const store = useRoomStore();
const { lastUpdate } = storeToRefs(store);

const lastUpdateFlash = ref(false);
let flashTimeout: ReturnType<typeof setTimeout> | null = null;
const initialUpdateCount = ref(0);

// Flash animation whenever lastUpdate changes
watch(
  () => lastUpdate.value?.getTime(),
  async () => {
    if (initialUpdateCount.value < 2) {
      initialUpdateCount.value++;
      return;
    }
    lastUpdateFlash.value = false;
    if (flashTimeout) clearTimeout(flashTimeout);
    await nextTick();
    flashTimeout = setTimeout(() => {
      lastUpdateFlash.value = true;
      flashTimeout = setTimeout(() => (lastUpdateFlash.value = false), 2000);
    }, 50);
  }
);
</script>

<template>
  <div
    class="absolute left-0 right-0 bottom-0 px-3 py-1 text-xs flex items-center justify-center text-center"
    :class="[
      Z_INDEX.HEADER,
      store.wsStatus === 'connected' ? 'frosted-status-connected' :
      store.wsStatus === 'connecting' ? 'frosted-status-connecting' :
      store.wsStatus === 'auth_failed' ? 'frosted-status-auth-failed' :
      'frosted-status-disconnected'
    ]"
  >
    <div v-if="store.wsStatus === 'connected'" class="flex flex-col md:flex-row">
      <div>
        ● Connected <span class="px-1">|</span>
        Last Updated:
        <span
          class="status-update-time"
          :class="{ 'status-update-flash': lastUpdateFlash }"
        >{{ store.lastUpdate ? formatTime(store.lastUpdate) : '…' }}</span>
      </div>
      <div class="flex items-center justify-center">
        <span class="hidden md:inline-block px-1 pr-2">||</span>
        <span>Active Users - </span>
        <span class="pl-1">Room: {{ store.watchingCount !== null ? store.watchingCount : '…' }}</span>
        <span class="px-1">|</span>
        <span>Sitewide: {{ store.totalConnected !== null ? store.totalConnected : '…' }}</span>
      </div>
    </div>
    <div v-else-if="store.wsStatus === 'connecting'">⟳ Connecting…</div>
    <div v-else-if="store.wsStatus === 'auth_failed'">⚠ Session expired — redirecting to login…</div>
    <div v-else>⚠ Disconnected — reconnecting…</div>
  </div>
</template>

<style scoped>
/* Status bar: "Last update" time flash */
.status-update-time {
  display: inline-block;
  padding: 0 4px;
  border-radius: 3px;
  position: relative;
}

/* White background that fades to transparent */
.status-update-time::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 3px;
  background: white;
  opacity: 0;
  pointer-events: none;
}

.status-update-flash::after {
  animation: update-flash 2s ease-out forwards;
}

@keyframes update-flash {
  0%   { opacity: 0.85; }
  15%  { opacity: 0.85; }
  100% { opacity: 0; }
}
</style>
