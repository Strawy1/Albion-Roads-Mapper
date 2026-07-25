<script setup lang="ts">
import { ref } from 'vue';
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent, TooltipPortal } from 'reka-ui';
import RoomSettings from '../RoomSettings.vue';
import RenameRoomModal from '../RenameRoomModal.vue';
import RoomServerModal from '../RoomServerModal.vue';
import { useRoomStore } from '@/stores/useRoomStore';
import { ROOM_SERVER_LABELS } from 'shared';
import { Z_INDEX } from '@/constants/Layers';

const store = useRoomStore();

defineProps<{
  roomTitle?: string;
}>();

const emit = defineEmits<{
  (e: 'logout'): void;
  (e: 'fitView'): void;
}>();

const renameModalOpen = ref(false);
const serverModalOpen = ref(false);
const copied = ref(false);

function copyLink() {
  navigator.clipboard.writeText(window.location.href).then(() => {
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  });
}
</script>

<template>
  <!-- Logo + room title, top-left -->
  <div :class="['absolute top-2 md:top-3 left-4 md:left-6 flex items-center gap-3 pr-16 md:pr-0', Z_INDEX.OVERLAY]">
    <img src="/iconportal.png" class="w-10 h-10 cursor-pointer shrink-0" alt="Site Logo" @click="emit('logout')" />
    <!-- Mobile-only lock indicator: desktop shows the LockedRoomFrame badge instead -->
    <span
      v-if="store.locked"
      class="md:hidden shrink-0 rounded-full bg-yellow-400 text-gray-900 text-xs font-bold px-2 py-1 shadow"
      data-testid="locked-title-indicator"
      title="This room is locked (read-only)"
    >🔒</span>
    <!-- Which Albion server this room maps. Read-only sessions see the label
         without the click target (the server would reject the change anyway). -->
    <component
      :is="store.canEdit ? 'button' : 'span'"
      v-if="store.roomServer"
      class="shrink-0 rounded-full frosted-pill px-3 py-2 text-sm font-semibold text-gray-200"
      :class="store.canEdit ? 'cursor-pointer hover:brightness-125 transition-[filter]' : ''"
      data-testid="room-server-pill"
      :title="store.canEdit ? 'Click to change the room\'s server' : 'Room server'"
      @click="store.canEdit && (serverModalOpen = true)"
    >{{ ROOM_SERVER_LABELS[store.roomServer] }}</component>
    <div v-if="roomTitle" class="flex items-center gap-1">
      <TooltipProvider :delay-duration="0">
        <TooltipRoot>
          <TooltipTrigger as-child>
            <div
              class="flex items-center gap-1 pl-4 pr-2 py-2 rounded-full frosted-pill cursor-pointer hover:brightness-125 transition-[filter]"
              data-testid="rename-room-button"
              @click="renameModalOpen = true"
            >
              <h1 class="text-xl font-bold text-gray-200 truncate" data-testid="room-title">{{ roomTitle }}</h1>
              <button
                class="text-base leading-none opacity-60 hover:opacity-100 transition-opacity shrink-0 ml-1"
                :title="copied ? 'Copied!' : 'Copy room link'"
                data-testid="copy-room-link"
                @click.stop="copyLink"
              >{{ copied ? '✓' : '🔗' }}</button>
            </div>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent
              class="bg-gray-900 border border-gray-600 text-white text-xs px-3 py-2 rounded shadow-xl pointer-events-none"
              :class="Z_INDEX.MODAL"
              :side-offset="6"
            >
              Click to edit
            </TooltipContent>
          </TooltipPortal>
        </TooltipRoot>
      </TooltipProvider>
    </div>
  </div>

  <!-- Settings cog at top-right -->
  <div :class="['absolute top-2 right-2', Z_INDEX.OVERLAY]">
    <RoomSettings :tray="true" />
  </div>

  <RenameRoomModal v-model="renameModalOpen" />
  <RoomServerModal v-model="serverModalOpen" />
</template>

<style scoped>
</style>
