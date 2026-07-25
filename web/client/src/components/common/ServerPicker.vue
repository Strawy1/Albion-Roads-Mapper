<script setup lang="ts">
/**
 * Three-way picker for the Albion server a room maps. Shared by the room
 * creation form and the in-room assign/change modal so both stay in sync with
 * the shared `ROOM_SERVERS` list.
 */
import { ROOM_SERVERS, ROOM_SERVER_LABELS, type RoomServer } from 'shared';

defineProps<{
  modelValue: RoomServer | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: RoomServer];
}>();
</script>

<template>
  <div class="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Albion server">
    <button
      v-for="server in ROOM_SERVERS"
      :key="server"
      type="button"
      role="radio"
      :aria-checked="modelValue === server"
      :disabled="disabled"
      :data-testid="`server-option-${server}`"
      class="px-3 py-2 rounded border text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      :class="modelValue === server
        ? 'bg-indigo-600 border-indigo-400 text-white'
        : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700'"
      @click="emit('update:modelValue', server)"
    >
      {{ ROOM_SERVER_LABELS[server] }}
    </button>
  </div>
</template>
