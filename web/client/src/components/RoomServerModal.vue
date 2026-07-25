<script setup lang="ts">
/**
 * Assigns the room's Albion server, in two modes:
 *
 * - `blocking` (mounted by RoomView while `store.needsServerAssignment`) — a
 *   room that predates the column has to be labelled before it can be used, so
 *   there is no cancel and the backdrop doesn't dismiss.
 * - normal (opened from the server pill in the title bar) — changing an
 *   existing value, which the server requires the admin password for.
 */
import { ref, computed, watch } from 'vue';
import { ROOM_SERVER_LABELS, type RoomServer } from 'shared';
import { useRoomStore } from '../stores/useRoomStore';
import { Z_INDEX } from '@/constants/Layers';
import ServerPicker from './common/ServerPicker.vue';

const props = defineProps<{
  modelValue: boolean;
  blocking?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const store = useRoomStore();

const selected = ref<RoomServer | null>(null);
const adminPassword = ref('');
const error = ref('');
const saving = ref(false);

// Mirrors the route's rule: only *changing* a recorded server needs the admin
// password — the first assignment goes through on the room token alone.
const needsAdminPassword = computed(
  () => !!store.roomServer && !!selected.value && selected.value !== store.roomServer
);

watch(() => props.modelValue, (open) => {
  if (!open) return;
  selected.value = store.roomServer;
  adminPassword.value = '';
  error.value = '';
}, { immediate: true });

function close() {
  if (props.blocking) return;
  emit('update:modelValue', false);
  error.value = '';
  adminPassword.value = '';
}

async function save() {
  if (!selected.value) {
    error.value = 'Pick a server first';
    return;
  }
  if (selected.value === store.roomServer) {
    emit('update:modelValue', false);
    return;
  }
  if (needsAdminPassword.value && !adminPassword.value.trim()) {
    error.value = 'Admin password is required to change the server';
    return;
  }

  saving.value = true;
  error.value = '';
  try {
    const res = await store.setRoomServer(
      selected.value,
      needsAdminPassword.value ? adminPassword.value : undefined
    );
    if (!res.ok) {
      error.value = res.error ?? 'Failed to set the room server';
      return;
    }
    emit('update:modelValue', false);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="fixed inset-0 bg-black/60 flex items-center justify-center p-4"
      :class="Z_INDEX.MODAL"
      data-testid="room-server-modal"
      @click.self="close"
    >
      <div class="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md" @click.stop>
        <h2 class="text-xl font-semibold mb-2 text-white">
          {{ store.roomServer ? 'Change Server' : 'Which server is this room on?' }}
        </h2>
        <p class="text-sm text-gray-400 mb-4">
          Map data is grouped by server so zone layouts and features can be compared across regions.
          <span v-if="blocking">Pick one to carry on using this room.</span>
        </p>
        <div class="flex flex-col gap-4">
          <ServerPicker v-model="selected" :disabled="saving" />

          <div v-if="needsAdminPassword">
            <label class="block text-sm text-gray-400 mb-1">Admin Password</label>
            <input
              v-model="adminPassword"
              type="password"
              placeholder="Admin password"
              data-testid="room-server-admin-password"
              class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white outline-none"
              @keydown.enter="save"
            />
            <p class="text-xs text-gray-500 mt-1">
              This room is already recorded as {{ ROOM_SERVER_LABELS[store.roomServer!] }} — changing
              it needs the admin password.
            </p>
          </div>

          <p v-if="error" class="text-red-400 text-sm" data-testid="room-server-error">{{ error }}</p>

          <div class="flex gap-2">
            <button
              v-if="!blocking"
              class="flex-1 px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-white font-medium transition-colors"
              @click="close"
            >
              Cancel
            </button>
            <button
              :disabled="saving || !selected"
              class="flex-1 px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              data-testid="room-server-save"
              @click="save"
            >
              {{ saving ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
