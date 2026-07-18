<script setup lang="ts">
import { useRoomStore } from '@/stores/useRoomStore';
import { Z_INDEX } from '@/constants/Layers';

const store = useRoomStore();
</script>

<template>
  <template v-if="store.locked">
    <!-- Desktop only: yellow frame flush with the viewport edges, its bottom
         edge sitting just above the connection status bar (~24px tall). -->
    <div
      class="hidden md:block pointer-events-none fixed inset-x-0 top-0 bottom-6 border-[3px] border-yellow-400/80 rounded-md"
      :class="Z_INDEX.UI_OVERLAY"
      data-testid="locked-room-frame"
    ></div>
    <!-- Badge straddling the bottom edge of the frame, centred, above the
         connection information bar. -->
    <div
      class="hidden md:flex pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 -translate-y-1/2 items-center gap-2"
      :class="Z_INDEX.UI_OVERLAY"
    >
      <span
        class="flex items-center gap-1.5 rounded-full bg-yellow-400 text-gray-900 text-xs font-bold uppercase tracking-wide px-3 py-1 shadow-lg"
        data-testid="locked-room-badge"
      >
        🔒 Locked
      </span>
      <span
        v-if="store.isAdmin"
        class="flex items-center gap-1 rounded-full bg-orange-600 text-white text-xs font-bold uppercase tracking-wide px-3 py-1 shadow-lg"
        data-testid="locked-admin-badge"
        title="The room is locked, but your admin token lets you keep editing"
      >
        ⚠️ Admin mode
      </span>
    </div>
  </template>
</template>
