<script setup lang="ts">
import { ref } from 'vue';
import { useRoomStore } from '../stores/useRoomStore';
import { API_BASE_URL } from '../utils/api';
import { Z_INDEX } from '@/constants/Layers';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const store = useRoomStore();

const newTitle = ref('');
const adminPassword = ref('');
const titleError = ref('');
const titleSuccess = ref(false);
const saving = ref(false);

function close() {
  emit('update:modelValue', false);
  newTitle.value = '';
  adminPassword.value = '';
  titleError.value = '';
  titleSuccess.value = false;
}

async function saveTitle() {
  if (!adminPassword.value.trim()) {
    titleError.value = 'Admin password cannot be empty';
    return;
  }

  saving.value = true;
  titleError.value = '';
  titleSuccess.value = false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/rooms/${store.roomId}/title`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${store.token}`,
      },
      body: JSON.stringify({ title: newTitle.value.trim(), adminPassword: adminPassword.value }),
    });
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      titleError.value = body.error ?? 'Failed to rename room';
      return;
    }
    titleSuccess.value = true;
    setTimeout(() => {
      close();
    }, 1000);
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
      @click.self="close"
    >
      <div class="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md" @click.stop>
        <h2 class="text-xl font-semibold mb-4 text-white">Rename Room</h2>
        <div class="flex flex-col gap-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">New Name</label>
            <input
              v-model="newTitle"
              type="text"
              placeholder="Room name (max 50 characters)"
              maxlength="50"
              class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white outline-none"
              @keydown.enter="saveTitle"
            />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Admin Password</label>
            <input
              v-model="adminPassword"
              type="password"
              placeholder="Admin password"
              class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white outline-none"
              @keydown.enter="saveTitle"
            />
          </div>
          <p v-if="titleError" class="text-red-400 text-sm">{{ titleError }}</p>
          <p v-if="titleSuccess" class="text-green-400 text-sm">Room renamed!</p>
          <div class="flex gap-2">
            <button
              class="flex-1 px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-white font-medium transition-colors"
              @click="close"
            >
              Cancel
            </button>
            <button
              :disabled="saving"
              class="flex-1 px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              @click="saveTitle"
            >
              {{ saving ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
