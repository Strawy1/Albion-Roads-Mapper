<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useRoomStore } from '../stores/useRoomStore.js';
import { API_BASE_URL } from '../utils/api';
import { track } from '@vercel/analytics';

const props = defineProps<{ id: string }>();
const router = useRouter();
const route = useRoute();
const store = useRoomStore();

const passwordRotatedBanner = computed(() => route.query.reason === 'password_rotated');
const roomDeletedBanner = computed(() => route.query.reason === 'room_deleted');
const roomNotFoundBanner = computed(() => route.query.reason === 'room_not_found');
const sessionExpiredBanner = computed(() => route.query.reason === 'session_expired');

const password = ref('');
const authError = ref('');
const authenticating = ref(false);
const roomNotFound = ref(false);
const checkingRoom = ref(true);

onMounted(async () => {
  // If the room was deleted or not found, show the not-found state immediately
  if (roomDeletedBanner.value || roomNotFoundBanner.value) {
    store.removeFromRecentRooms(props.id);
    roomNotFound.value = true;
    checkingRoom.value = false;
    return;
  }

  // Check that the room actually exists before doing anything else
  try {
    const res = await fetch(`${API_BASE_URL}/api/rooms/resolve/${props.id}`);
    if (res.status === 404) {
      store.removeFromRecentRooms(props.id);
      roomNotFound.value = true;
      checkingRoom.value = false;
      return;
    }
  } catch {
    // Network error — fall through and let the user try to authenticate
  }
  checkingRoom.value = false;

  // If already authenticated (token in local storage), go straight to the room
  const stored = localStorage.getItem(`token:${props.id}`);
  if (stored) {
    store.setCredentials(props.id, stored);
    router.replace({ path: `/rooms/${props.id}` });
  }
});

async function authenticate() {
  if (!password.value) return;
  authenticating.value = true;
  authError.value = '';
  try {
    const res = await fetch(`${API_BASE_URL}/api/rooms/${props.id}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value }),
    });
    if (!res.ok) {
      if (res.status === 401) {
        authError.value = 'Invalid password';
      } else {
        authError.value = 'Server error, please try again later';
      }
      return;
    }
    const { token } = await res.json() as { token: string };
    localStorage.setItem(`token:${props.id}`, token);
    store.setCredentials(props.id, token);
    track('authenticate_room');
    router.push({ path: `/rooms/${props.id}` });
  } catch (e) {
    authError.value = 'Network error, please check your connection';
  } finally {
    authenticating.value = false;
  }
}
</script>

<template>
  <div class="h-dvh flex items-center justify-center bg-gray-950 text-white p-6">
    <!-- Room not found error state -->
    <div v-if="roomNotFound" class="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-red-400 text-2xl">⚠️</span>
        <h2 class="text-xl font-semibold text-red-400">Room no longer exists!</h2>
      </div>
      <div v-if="roomDeletedBanner" class="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        <strong>Room was deleted!</strong> The room owner permanently deleted this room.
      </div>
      <div v-else-if="roomNotFoundBanner" class="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        <strong>Map Room / Page not found!</strong> Please double check the link!
      </div>
      <p class="text-gray-400 text-sm mb-5">
        If this room was in your recently visited list, it has now been removed.
      </p>
      <button
        class="w-full px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 font-medium mb-3"
        @click="router.push('/?create=true')"
      >
        Create a New Room
      </button>
      <button
        class="w-full px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 font-medium"
        @click="router.push('/')"
      >
        Go to Home Page
      </button>
    </div>

    <!-- Normal auth form -->
    <div v-else-if="!checkingRoom" class="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm">
      <h2 class="text-xl font-semibold mb-4">Enter Room Password</h2>
      <div v-if="sessionExpiredBanner" class="mb-4 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
        <strong>Session expired.</strong> Please log in again to continue.
      </div>
      <div v-else-if="passwordRotatedBanner" class="mb-4 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
        <strong>Room password has been rotated.</strong> Please re-enter the new password to continue.
      </div>
      <p class="text-gray-400 text-sm mb-4">Room: <code class="text-indigo-300">{{ id }}</code></p>

      <input
        v-model="password"
        type="password"
        placeholder="Password"
        class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white outline-none mb-3"
        @keydown.enter="authenticate"
      />
      <p v-if="authError" class="text-red-400 text-sm mb-3">{{ authError }}</p>
      <button
        :disabled="!password || authenticating"
        class="w-full px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 font-medium disabled:opacity-50"
        @click="authenticate"
      >
        {{ authenticating ? 'Authenticating…' : 'Enter' }}
      </button>
      <hr class="my-4 border-gray-700" />
      <button
        class="w-full px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 font-medium"
        @click="router.push('/?create=true')"
      >
        Create a new Room
      </button>
    </div>
  </div>
</template>
