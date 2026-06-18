<script setup lang="ts">
import { ref, computed } from 'vue';
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent, TooltipPortal } from 'reka-ui';
import { useRoomStore } from '@/stores/useRoomStore';
import { storeToRefs } from 'pinia';
import { Z_INDEX } from '@/constants/Layers';

const SPLASH_SEEN_KEY = 'splash:v12:seen';
const CTA_DISMISSED_KEY = 'cta:chainManagement:dismissed';

const store = useRoomStore();
const { nodePositions, connections } = storeToRefs(store);

const hasMapHistory = computed(() =>
  nodePositions.value.length > 1 || connections.value.length > 0
);

const hasOpenedChainManager = computed(() =>
  typeof localStorage !== 'undefined' && localStorage.getItem(CTA_DISMISSED_KEY) === '1'
);

const hasSeen = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(SPLASH_SEEN_KEY) === '1'
);

const visible = computed(() =>
  !hasSeen.value && hasMapHistory.value && !hasOpenedChainManager.value
);

function dismiss() {
  hasSeen.value = true;
  try { localStorage.setItem(SPLASH_SEEN_KEY, '1'); } catch { /* ignore */ }
}

function openChainManager() {
  dismiss();
  store.openChainManagement();
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 bg-black/70 flex items-center justify-center p-2 md:p-8"
      :class="Z_INDEX.MODAL"
      @click.self="dismiss"
    >
      <div
        class="relative bg-gray-900 border border-gray-700 rounded-xl p-4 md:p-6 w-full md:max-w-5xl shadow-2xl overflow-y-auto max-h-full"
        @click.stop
      >
        <!-- Close button -->
        <button
          class="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-white hover:bg-gray-700 transition-colors text-lg leading-none"
          title="Dismiss"
          @click="dismiss"
        >✕</button>

        <!-- Header -->
        <div class="mb-4 pr-8">
          <span class="inline-block text-xs font-semibold uppercase tracking-widest text-indigo-400 mb-1">What's new in v1.2</span>
          <h2 class="text-2xl font-bold text-white">Chain Management</h2>
        </div>

        <!-- Video -->
        <div class="rounded-lg overflow-hidden bg-black mb-5 aspect-video w-full">
          <video
            class="w-full h-full object-contain"
            autoplay
            loop
            muted
            playsinline
            :src="'/media/chain-management-demo.mp4'"
          />
        </div>

        <!-- Description -->
        <p class="text-sm text-gray-300 mb-6">
          Chains let you create <strong>multiple independent groups of zones</strong> within a single room — perfect for exploring outwards from Black Zones into Roads of Avalon. Each chain has its own source zone and updatable colour. Source zones for chains can be relocated as needed. Note:
          <TooltipProvider :delay-duration="0">
            <TooltipRoot>
              <TooltipTrigger as-child>
                <span class="text-yellow-500 underline decoration-dotted cursor-help">chains cannot be linked together.</span>
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent
                  class="bg-gray-950 border border-gray-700 text-gray-200 text-xs px-3 py-2 rounded shadow-xl z-[10000] max-w-xs"
                  side="top"
                >
                  Route plotting and connection deletions both use tree-traversal algorithms that require loop-free graphs. In Roads of Avalon, two zones can be joined by more than one portal pair, which would create a cycle.<br><br>Additionally, if you wanted to delete a connection containing a bunch of linked expired zones, and if that went into another chain, it <strong>could</strong> cause unintended data loss, as the "source" of the tree is not known. Keeping chains strictly separate eliminates that risk entirely.
                </TooltipContent>
              </TooltipPortal>
            </TooltipRoot>
          </TooltipProvider>
        </p>

        <p class="text-sm text-gray-300 mb-6">
          Rooms are now able to be created using <strong>Royal Continent, Outlands zones or Brecillien</strong>! You can however change your zone on the fly using the Chain Manager, just update your primary zone.
        </p>

        <!-- Actions -->
        <div class="flex gap-3">
          <button
            class="flex-1 px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-white font-medium transition-colors"
            @click="dismiss"
          >
            Got it
          </button>
          <button
            class="flex-1 px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
            @click="openChainManager"
          >
            Open Chain Manager ⛓️
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
