<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Z_INDEX } from '@/constants/Layers';
import { sendEvent } from '@/utils/events';
import TipButton from './TipButton.vue';

const LAST_VISIT_KEY = 'donate:lastVisitAt';
const VISIT_COUNT_KEY = 'donate:visitCount';
const DISMISSED_KEY = 'donate:dismissed';
// Set by TipButton when the Ko-fi button is clicked anywhere in the app.
const TIPPED_KEY = 'tippedNavigator';

// Visits more than this far apart count as separate visits.
const VISIT_WINDOW_MS = 6 * 60 * 60 * 1000;
// Show the prompt once this many distinct visits have been counted.
const VISIT_THRESHOLD = 3;

const visible = ref(false);
// Flips when the Ko-fi button is clicked: the modal stays open and swaps to a
// thank-you state instead of dismissing (Ko-fi opens in a new tab).
const tipped = ref(false);

onMounted(() => {
  try {
    // Never prompt again once dismissed, or if they've already clicked Ko-fi.
    if (localStorage.getItem(DISMISSED_KEY) || localStorage.getItem(TIPPED_KEY)) return;

    // Count a visit only when the last *counted* visit was over 6 h ago, so
    // each counted visit anchors a fresh window (a sliding timestamp would let
    // frequent visitors never reach the threshold).
    const now = Date.now();
    const lastVisit = parseInt(localStorage.getItem(LAST_VISIT_KEY) ?? '0', 10);
    let count = parseInt(localStorage.getItem(VISIT_COUNT_KEY) ?? '0', 10) || 0;
    if (!lastVisit || now - lastVisit > VISIT_WINDOW_MS) {
      count += 1;
      localStorage.setItem(VISIT_COUNT_KEY, String(count));
      localStorage.setItem(LAST_VISIT_KEY, String(now));
    }

    if (count >= VISIT_THRESHOLD) {
      visible.value = true;
      sendEvent('donation_modal_shown');
    }
  } catch { /* localStorage unavailable — never block the app */ }
});

function dismiss() {
  visible.value = false;
  try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* ignore */ }
}

/**
 * Opens the modal straight in its thank-you state, bypassing the visit-count
 * gating — used when the planner's Tip the Navigator button is clicked.
 */
function showThanks() {
  tipped.value = true;
  visible.value = true;
}

defineExpose({ showThanks });
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-200 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="visible"
        class="fixed inset-0 bg-black/70 flex items-center justify-center p-2 md:p-8"
        :class="Z_INDEX.MODAL"
        @click.self="dismiss"
      >
        <div
          class="relative bg-gray-900 border border-gray-700 rounded-xl p-4 md:p-6 w-full max-w-md shadow-2xl"
          @click.stop
        >
          <!-- Close button -->
          <button
            class="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-white hover:bg-gray-700 transition-colors text-lg leading-none"
            title="Dismiss"
            @click="dismiss"
          >✕</button>

          <div class="text-center mb-6">
            <span class="text-lg font-bold uppercase tracking-widest text-indigo-400">
              {{ tipped ? 'Thank you!' : 'Please consider donating' }}
            </span>
          </div>

          <template v-if="!tipped">
            <div class="flex justify-center mb-6">
              <TipButton source="modal" @clicked="tipped = true" />
            </div>

            <p class="text-base text-gray-300 leading-relaxed mb-4">
              I hope you're enjoying the tool! A decent amount of cost went into the development of the project, as well as continual operating costs,
              so if you'd like to support its continued development, please consider donating above — even a small amount genuinely helps!
            </p>
            <p class="text-base text-gray-300 leading-relaxed">— Matt</p>
          </template>

          <template v-else>
            <p class="text-base text-gray-300 leading-relaxed mb-4">
              Thank you so much for supporting the tool — it genuinely means a
              lot and goes straight towards its continued development. ❤️
            </p>
            <p class="text-base text-gray-300 leading-relaxed mb-6">— Matt</p>

            <div class="flex justify-center">
              <button
                class="px-6 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors shadow-lg"
                @click="dismiss"
              >
                Close
              </button>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
