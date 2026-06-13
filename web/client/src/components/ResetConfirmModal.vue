<script setup lang="ts">
import { ref } from 'vue';
import { Z_INDEX } from '@/constants/Layers';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'confirmed': [];
  'confirmedWithHistory': [];
  'confirmedDeleteRoom': [adminPassword: string, setError: (msg: string) => void];
}>();

const deleteRoomPassword = ref('');
const deleteRoomError = ref('');

function close() {
  deleteRoomPassword.value = '';
  deleteRoomError.value = '';
  emit('update:modelValue', false);
}

function confirm() {
  emit('confirmed');
  close();
}

function confirmDeleteRoom() {
  if (!deleteRoomPassword.value.trim()) {
    deleteRoomError.value = 'Admin password is required';
    return;
  }
  const password = deleteRoomPassword.value;
  deleteRoomPassword.value = '';
  deleteRoomError.value = '';
  emit('confirmedDeleteRoom', password, (msg: string) => {
    deleteRoomError.value = msg;
  });
}
</script>

<template>
  <Teleport to="body">
  <div
    v-if="modelValue"
    class="fixed inset-0 bg-black/60 flex items-center justify-center p-4"
    :class="Z_INDEX.MODAL"
    @click.self="close"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md" @click.stop>
      <h2 class="text-xl font-semibold mb-2 text-white">Are you sure you wish to reset the room?</h2>
      <p class="text-sm text-gray-400 mb-6">Data will not be recoverable. If you're doing this to attempt to fix a data error, please consider contacting us on <a
          href="https://discord.gg/uFq2PJuZ3r"
          target="_blank"
          class="text-indigo-500 font-medium transition-colors text-center"
      >Discord</a><strong> first</strong>.</p>
      <div class="flex gap-3 justify-end">
        <button
          class="px-5 py-2 rounded bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
          @click="confirm"
        >
          Yes
        </button>
        <button
          class="px-5 py-2 rounded bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
          @click="() => { emit('confirmedWithHistory'); close(); }"
        >
          Yes & Delete History
        </button>
        <button
          class="px-5 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
          @click="close"
        >
          No
        </button>
      </div>

      <div class="mt-6 border-t border-gray-700 pt-5">
        <p class="text-md font-semibold text-red-400 mb-1">Delete the whole room</p>
        <p class="text-xs text-gray-400 mb-3">This will <strong>permanently close the room and delete all data</strong>. This action cannot be undone. An admin password is required.</p>
        <div class="flex gap-2 items-center">
          <input
            v-model="deleteRoomPassword"
            type="password"
            placeholder="Admin password"
            class="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm outline-none"
            @keydown.enter="confirmDeleteRoom"
          />
          <button
            :disabled="!deleteRoomPassword.trim()"
            class="px-4 py-2 rounded bg-red-800 hover:bg-red-700 text-white text-sm font-medium transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            @click="confirmDeleteRoom"
          >
            Delete Room
          </button>
        </div>
        <p v-if="deleteRoomError" class="text-red-400 text-xs mt-2">{{ deleteRoomError }}</p>
      </div>
    </div>
  </div>
  </Teleport>
</template>
