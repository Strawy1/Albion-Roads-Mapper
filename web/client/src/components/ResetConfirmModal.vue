<script setup lang="ts">
import { ref } from 'vue';
import { Z_INDEX } from '@/constants/Layers';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'confirmedWithHistory': [adminPassword: string, setError: (msg: string) => void];
  'confirmedDeleteRoom': [adminPassword: string, setError: (msg: string) => void];
  'confirmedClearRoom': [];
}>();

const adminPassword = ref('');
const adminError = ref('');

function close() {
  adminPassword.value = '';
  adminError.value = '';
  emit('update:modelValue', false);
}

function confirmClearRoom() {
  emit('confirmedClearRoom');
  close();
}

function confirmWithHistory() {
  if (!adminPassword.value.trim()) {
    adminError.value = 'Admin password is required';
    return;
  }
  const password = adminPassword.value;
  adminPassword.value = '';
  adminError.value = '';
  emit('confirmedWithHistory', password, (msg: string) => {
    adminError.value = msg;
  });
}

function confirmDeleteRoom() {
  if (!adminPassword.value.trim()) {
    adminError.value = 'Admin password is required';
    return;
  }
  const password = adminPassword.value;
  adminPassword.value = '';
  adminError.value = '';
  emit('confirmedDeleteRoom', password, (msg: string) => {
    adminError.value = msg;
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
    <div class="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md overflow-hidden" @click.stop>
      <!-- Top section -->
      <div class="p-6">
        <h2 class="text-xl font-semibold mb-2 text-white">Are you sure you wish to reset the room?</h2>
        <p class="text-sm text-gray-400 mb-6">This will delete all connections, <strong>but will perserve the Room History</strong>. If you're doing this to attempt to fix a data error, please consider contacting us on <a
            href="https://discord.gg/uFq2PJuZ3r"
            target="_blank"
            class="text-indigo-500 font-medium transition-colors text-center"
        >Discord</a><strong> first</strong>.</p>
        <div class="flex gap-3 justify-end">
          <button
            class="px-5 py-2 rounded bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
            @click="confirmClearRoom"
          >
            Clear Room
          </button>
          <button
            class="px-5 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
            @click="close"
          >
            No
          </button>
        </div>
      </div>

      <!-- Admin password section (dark red) -->
      <div class="bg-red-950/60 border-t border-red-900 px-6 py-4">
        <input
          v-model="adminPassword"
          type="password"
          placeholder="Admin password"
          class="w-full bg-gray-900 border border-red-800 rounded px-3 py-2 text-white text-sm outline-none mb-3"
          @keydown.enter="confirmWithHistory"
        />
        <p v-if="adminError" class="text-red-400 text-xs mb-3">{{ adminError }}</p>
        <p class="text-xs text-red-300 mb-3">This will fully reset the room, <strong>deleting all history and zone information</strong>. This cannot be recovered. Please only do this if you are explicitly instructed to by the developer!</p>
        <div class="flex gap-3">
          <button
            :disabled="!adminPassword.trim()"
            class="w-full px-4 py-2 rounded bg-red-700 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            @click="confirmWithHistory"
          >
            Fully Reset Room
          </button>
        </div>
      </div>

      <!-- Delete room section (darker red) -->
      <div class="bg-red-800/80 px-6 py-4">
        <p class="text-xs text-red-300 mb-3">This will fully delete the room and close it. <strong>This cannot be undone!</strong></p>
        <button
          :disabled="!adminPassword.trim()"
          class="w-full px-4 py-2 rounded border border-red-600 bg-red-600 hover:bg-black hover:border-white  text-white text-sm font-medium transition-colors disabled:bg-red-800/50 disabled:border-red-800/50 disabled:cursor-not-allowed disabled:text-gray-500"
          @click="confirmDeleteRoom"
        >
          Delete Room
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>
