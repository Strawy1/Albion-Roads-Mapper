<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoomStore } from '../stores/useRoomStore';
import { Z_INDEX } from '@/constants/Layers';

defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const store = useRoomStore();

const adminPassword = ref('');
const error = ref('');
const success = ref(false);
const saving = ref(false);

// Captured at submit time so the success copy matches the action just taken
// (store.locked flips as part of the request).
const justLocked = ref(false);

const willLock = computed(() => !store.locked);

function close() {
  emit('update:modelValue', false);
  adminPassword.value = '';
  error.value = '';
  success.value = false;
  saving.value = false;
}

async function submit() {
  if (!adminPassword.value.trim()) {
    error.value = 'Admin password cannot be empty';
    return;
  }
  saving.value = true;
  error.value = '';
  success.value = false;
  try {
    const target = willLock.value;
    // Always exchange the admin password for a fresh admin token — this is
    // what grants this session edit rights while the room is locked.
    const auth = await store.adminAuthenticate(adminPassword.value);
    if (!auth.ok) {
      error.value = auth.error ?? 'Admin authentication failed';
      return;
    }
    const res = await store.setRoomLock(target);
    // Reconnect only after the lock PATCH has landed: the new socket's `sync`
    // re-reads the DB, so reconnecting earlier would race the UPDATE and
    // clobber `locked` back to its old value on this client.
    store.reconnect();
    if (!res.ok) {
      error.value = res.error ?? 'Failed to update room lock';
      return;
    }
    justLocked.value = target;
    success.value = true;
    adminPassword.value = '';
    setTimeout(() => {
      close();
    }, 2500);
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
    <div class="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md" @click.stop data-testid="lock-room-modal">
      <h2 class="text-xl font-semibold mb-2 text-white">{{ willLock ? '🔒 Lock Room' : '🔓 Unlock Room' }}</h2>
      <p class="text-sm text-gray-400 mb-4">
        <template v-if="willLock">
          Locking makes the room <b>read-only</b> for everyone else. Only users who enter the
          admin password gain admin mode and can keep editing.
        </template>
        <template v-else>
          Unlocking lets everyone with the room password edit the map again.
        </template>
      </p>
      <div class="flex flex-col gap-4">
        <div>
          <label class="block text-sm text-gray-400 mb-1">Admin Password</label>
          <input
            v-model="adminPassword"
            type="password"
            placeholder="Admin password"
            class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white outline-none"
            data-testid="lock-room-admin-password"
            @keydown.enter="submit"
          />
        </div>
        <p v-if="error" class="text-red-400 text-sm" data-testid="lock-room-error">{{ error }}</p>
        <div v-if="success" class="text-sm rounded border border-yellow-500/60 bg-yellow-500/10 px-3 py-2" data-testid="lock-room-success">
          <template v-if="justLocked">
            <p class="text-yellow-300 font-medium">🔒 Room locked.</p>
            <p class="text-yellow-200 mt-1">⚠️ You are now in <b>admin mode</b> — you can still edit while everyone else is read-only.</p>
          </template>
          <template v-else>
            <p class="text-green-400 font-medium">🔓 Room unlocked — everyone can edit again.</p>
          </template>
        </div>
        <div class="flex gap-2">
          <button
            :disabled="saving || !adminPassword.trim()"
            class="flex-1 px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            data-testid="lock-room-submit"
            @click="submit"
          >
            {{ saving ? 'Working…' : (willLock ? 'Lock Room' : 'Unlock Room') }}
          </button>
          <button
            class="flex-1 px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-white font-medium transition-colors"
            @click="close"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
  </Teleport>
</template>
