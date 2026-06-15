<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { Z_INDEX } from '@/constants/Layers';
import { useRouter } from 'vue-router';
import { useRoomStore } from '@/stores/useRoomStore';
import { useRoomMemoryStore } from '@/stores/useRoomMemoryStore';
import { API_BASE_URL } from '@/utils/api';
import { track } from '@vercel/analytics';
import ChangePasswordModal from './ChangePasswordModal.vue';
import ResetConfirmModal from './ResetConfirmModal.vue';
declare const __APP_VERSION__: string;
declare const __APP_COMMIT_SHA__: string;
const appVersion = __APP_VERSION__;
const appCommitSha = __APP_COMMIT_SHA__;

const props = defineProps<{
  tray?: boolean;
  fullWidth?: boolean;
}>();

const store = useRoomStore();
const memoryStore = useRoomMemoryStore();
const router = useRouter();
const cogRef = ref<HTMLElement | null>(null);

const open = ref(false);
const popupEl = ref<HTMLDivElement | null>(null);

// Change password state
const showChangePasswordModal = ref(false);
const showResetConfirmModal = ref(false);

// Reset state
const resetting = ref(false);
const resetError = ref('');

// Copy link state
const copied = ref(false);

function toggleOpen() {
  open.value = !open.value;
  if (!open.value) resetSubForms();
}

function resetSubForms() {
  showChangePasswordModal.value = false;
  showResetConfirmModal.value = false;
  resetError.value = '';
  copied.value = false;
}

function onClickOutside(e: MouseEvent) {
  if (open.value && popupEl.value && !popupEl.value.contains(e.target as Node)) {
    open.value = false;
    resetSubForms();
  }
}

onMounted(() => document.addEventListener('click', onClickOutside));
onBeforeUnmount(() => document.removeEventListener('click', onClickOutside));

async function clearRoom() {
  resetting.value = true;
  resetError.value = '';
  try {
    const res = await fetch(`${API_BASE_URL}/api/rooms/${store.roomId}/connections`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${store.token}`,
      },
    });
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      resetError.value = body.error ?? 'Reset failed';
      return;
    }
    open.value = false;
    resetSubForms();
    await track('clear_room');
    window.location.reload();
  } finally {
    resetting.value = false;
  }
}

async function resetWithHistory(adminPassword: string, setError: (msg: string) => void) {
  resetting.value = true;
  try {
    const connectionsRes = await fetch(`${API_BASE_URL}/api/rooms/${store.roomId}/connections`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${store.token}`,
      },
      body: JSON.stringify({ adminPassword }),
    });
    if (!connectionsRes.ok) {
      const body = await connectionsRes.json() as { error?: string };
      setError(body.error ?? 'Reset failed');
      return;
    }
    await fetch(`${API_BASE_URL}/api/rooms/${store.roomId}/memory`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${store.token}`,
      },
      body: JSON.stringify({ adminPassword }),
    });
    memoryStore.clear();
    open.value = false;
    resetSubForms();
    await track('reset_all_connections_with_history');
    window.location.reload();
  } finally {
    resetting.value = false;
  }
}

async function deleteRoom(adminPassword: string, setError: (msg: string) => void) {
  resetting.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/rooms/${store.roomId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${store.token}`,
      },
      body: JSON.stringify({ adminPassword }),
    });
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      setError(body.error ?? 'Delete failed');
      return;
    }
    track('delete_room');
    store.exitRoom();
    router.replace({ path: '/' });
  } finally {
    resetting.value = false;
  }
}

// savePassword function removed from here, it's now in ChangePasswordModal.vue

function copyLink() {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    copied.value = true;
    track('copy_room_link');
    setTimeout(() => { copied.value = false; }, 2000);
  });
}


function exitRoom() {
  store.exitRoom();
  router.replace({ path: '/' });
}
</script>

<template>
  <div class="contents">
    <div ref="popupEl" :class="['relative', fullWidth ? 'w-full' : 'shrink-0', open ? Z_INDEX.OVERLAY : '']">
      <!-- Cog button -->
      <button
        ref="cogRef"
        type="button"
        :class="[
          'w-12 h-12 flex items-center justify-center rounded-full border text-xl shadow-lg transition-colors',
          open ? 'bg-indigo-600 border-indigo-400 hover:bg-indigo-500' : 'frosted-button border-gray-600 hover:bg-gray-700'
        ]"
        title="Room settings"
        data-testid="settings-cog"
        @click="toggleOpen"
      >
        <!-- gear icon (SVG) -->
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
          <path fill-rule="evenodd" d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 0 0-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 0 0-2.282.819l-.922 1.597a1.875 1.875 0 0 0 .432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 0 0 0 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 0 0-.432 2.385l.922 1.597a1.875 1.875 0 0 0 2.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 0 0 2.28-.819l.923-1.597a1.875 1.875 0 0 0-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 0 0 0-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 0 0-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 0 0-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 0 0-1.85-1.567h-1.843ZM12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z" clip-rule="evenodd" />
        </svg>
      </button>

      <!-- Popup -->
      <div
        v-if="open"
        :class="[
          'absolute w-64 bg-gray-900 border border-gray-600 rounded shadow-xl',
          tray ? 'right-0 top-full mt-2' : 'left-0 top-full mt-1',
          Z_INDEX.OVERLAY
        ]"
        data-testid="settings-popup"
      >
        <!-- Shape Background Opacity -->
        <div class="border-b border-gray-700 p-2">
          <div class="w-full text-left px-3 py-2 text-sm text-gray-200">
            👣 Path Background Opacity
          </div>
          <div class="px-3 pb-1">
            <label class="text-xs text-gray-400 block mb-1">Opacity: {{ store.shapeBackgroundOpacity === 0 ? 'Off' : `${store.shapeBackgroundOpacity}%` }}</label>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              :value="store.shapeBackgroundOpacity"
              @input="e => store.setShapeBackgroundOpacity(Number((e.target as HTMLInputElement).value))"
              class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        </div>

        <!-- Animations -->
        <div class="border-b border-gray-700 p-2">
          <button
            type="button"
            class="w-full text-left px-3 py-2 text-sm rounded text-gray-200 hover:bg-gray-700 flex items-center justify-between"
            @click="store.setAnimationsEnabled(!store.animationsEnabled)"
          >
            <span class="inline-flex items-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg> Animations</span>
            <span :class="store.animationsEnabled ? 'text-green-400' : 'text-gray-500'">{{ store.animationsEnabled ? 'On' : 'Off' }}</span>
          </button>
        </div>

        <!-- Blue Prompts -->
        <div class="border-b border-gray-700 px-2 py-2">
          <button
            type="button"
            class="w-full text-left px-3 py-1 text-sm rounded text-gray-200 hover:bg-gray-700 flex items-center justify-between"
            @click="store.setBluePromptsEnabled(!store.bluePromptsEnabled)"
          >
            <span class="inline-flex items-center gap-1.5">
              💡
              <span class="inline-block bg-blue-600 border-2 border-blue-400 text-white text-sm leading-none px-2 py-1 rounded shadow">Hints</span>
            </span>
            <span :class="store.bluePromptsEnabled ? 'text-green-400' : 'text-gray-500'">{{ store.bluePromptsEnabled ? 'On' : 'Off' }}</span>
          </button>
        </div>

        <!-- Change password -->
        <div class="border-b border-gray-700 p-2">
          <button
            type="button"
            class="w-full text-left px-3 py-2 text-sm rounded text-gray-200 hover:bg-gray-700"
            data-testid="settings-change-password-toggle"
            @click="showChangePasswordModal = true"
          >
            🔒  Change password
          </button>
        </div>

        <!-- Copy link -->
        <div class="border-b border-gray-700 p-2">
          <button
            type="button"
            class="w-full text-left px-3 py-2 text-sm rounded text-gray-200 hover:bg-gray-700"
            data-testid="settings-copy-link"
            @click="copyLink"
          >
            {{ copied ? '✓  Copied!' : '🔗  Copy room link' }}
          </button>
        </div>

        <!-- Reset Room -->
        <div class="border-b border-gray-700 p-2">
          <button
            type="button"
            class="w-full text-left px-3 py-2 text-sm rounded text-red-400 hover:bg-red-700 hover:text-white"
            data-testid="settings-reset-room"
            @click="showResetConfirmModal = true"
          >
            🗑️  Reset / Delete Room
          </button>
        </div>

        <!-- Logout -->
        <div class="border-b border-gray-700 p-2">
          <button
            type="button"
            class="w-full text-left px-3 py-2 text-sm rounded text-red-400 hover:bg-gray-700 hover:text-red-300"
            @click="exitRoom"
          >
            🚪 Exit Room
          </button>
        </div>

        <!-- Version -->
        <div class="px-4 py-2 text-xs text-gray-500 text-right">
          v{{ appVersion }} | {{ appCommitSha ? ` (${appCommitSha})` : ' UNKNOWN / LOCAL' }}
        </div>
      </div>
    </div>
    <ChangePasswordModal v-model="showChangePasswordModal" />
    <ResetConfirmModal v-model="showResetConfirmModal" @confirmed-clear-room="clearRoom" @confirmed-with-history="resetWithHistory" @confirmed-delete-room="deleteRoom" />
  </div>
</template>
