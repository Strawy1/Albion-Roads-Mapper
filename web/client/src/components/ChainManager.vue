<script setup lang="ts">
import { computed, ref } from 'vue';
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent, TooltipPortal } from 'reka-ui';
import { useRoomStore } from '@/stores/useRoomStore';
import { track } from '@vercel/analytics';
import { Z_INDEX } from '@/constants/Layers';
import { ZONE_BY_ID } from 'shared';
import ZoneCombobox from './ZoneCombobox.vue';
import ChainIdPill from './common/ChainIdPill.vue';

defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const store = useRoomStore();

const sourceZoneId = ref('');
const error = ref('');
const success = ref(false);
const saving = ref(false);
const removingChainId = ref<string | null>(null);
const relocatingChainId = ref<string | null>(null);

// When non-null, the colour-picker popover is shown above that chain row.
const colourPickerChainId = ref<string | null>(null);
// When non-null, the relocate zone-picker row is shown for that chain.
const relocatePickerChainId = ref<string | null>(null);
const relocateTargetZoneId = ref('');

const chains = computed(() => store.chains);
const primaryHomeZoneId = computed(() => store.homeZoneId);

// Zones that cannot be used as a new chain source: already a source zone or
// already a member of an existing chain.
const disabledZoneIds = computed(() =>
  [...store.chainSourceZoneIds, ...store.chainMemberZoneIds]
);

// The colour palette offered by the picker. Re-uses the shared palette
// where possible.
const PICKER_COLOURS: { name: string; hex: string }[] = [
  { name: 'Red', hex: '#ef4444' },
  { name: 'Orange', hex: '#f59e0b' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Light purple', hex: '#a78bfa' },
  { name: 'White', hex: '#ffffff' },
];

function zoneName(zoneId: string): string {
  return ZONE_BY_ID.get(zoneId)?.name ?? zoneId;
}

function close() {
  emit('update:modelValue', false);
  sourceZoneId.value = '';
  error.value = '';
  success.value = false;
  colourPickerChainId.value = null;
  relocatePickerChainId.value = null;
  relocateTargetZoneId.value = '';
}

function toggleRelocatePicker(chainId: string) {
  if (relocatePickerChainId.value === chainId) {
    relocatePickerChainId.value = null;
    relocateTargetZoneId.value = '';
  } else {
    relocatePickerChainId.value = chainId;
    relocateTargetZoneId.value = '';
    colourPickerChainId.value = null;
  }
}

async function confirmRelocate(chainId: string, currentSourceZoneId: string) {
  if (!relocateTargetZoneId.value) {
    error.value = 'Choose a new home zone';
    return;
  }
  if (relocateTargetZoneId.value === currentSourceZoneId) {
    error.value = 'New home zone must be different from the current one';
    return;
  }
  const targetName = zoneName(relocateTargetZoneId.value);
  const currentName = zoneName(currentSourceZoneId);
  if (!confirm(`Relocate this chain's home from "${currentName}" to "${targetName}"?\n\nThis will DELETE every zone and connection currently in the chain. This cannot be undone.`)) {
    return;
  }
  relocatingChainId.value = chainId;
  error.value = '';
  try {
    await store.relocateChain(chainId, relocateTargetZoneId.value);
    track('relocate_chain');
    relocatePickerChainId.value = null;
    relocateTargetZoneId.value = '';
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to relocate chain';
  } finally {
    relocatingChainId.value = null;
  }
}

function toggleColourPicker(chainId: string) {
  colourPickerChainId.value = colourPickerChainId.value === chainId ? null : chainId;
}

async function chooseColour(chainId: string, hex: string) {
  error.value = '';
  try {
    await store.updateChainColor(chainId, hex);
    track('chain_color_changed');
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to update chain colour';
  } finally {
    colourPickerChainId.value = null;
  }
}

function save() {
  if (!sourceZoneId.value) {
    error.value = 'Choose a zone';
    return;
  }

  // Defer actual chain creation until the user left-clicks on the canvas to
  // place the source zone. RoomView renders the cursor ghost and calls
  // store.addChain(zoneId, { x, y }) once a placement click is registered.
  error.value = '';
  success.value = false;
  store.beginPlacingChain(sourceZoneId.value);
  track('add_chain_begin_placement');
  sourceZoneId.value = '';
  close();
}

async function removeChain(chainId: string, sourceZoneId: string) {
  if (!confirm(`Delete the chain starting at "${zoneName(sourceZoneId)}"? This removes every zone and connection in that chain.`)) {
    return;
  }
  removingChainId.value = chainId;
  error.value = '';
  try {
    await store.removeChain(chainId);
    track('remove_chain');
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to remove chain';
  } finally {
    removingChainId.value = null;
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
      <h2 class="text-xl font-semibold mb-4 text-white">Chain Management</h2>

      <div class="flex flex-col gap-4">
        <p class="text-xs text-gray-400">Chains are a means to create multiple separated groups of zones, each having a source zone. This is useful in the case you're exploring from Black Zones / Royal Continent into Roads from different locations.</p>
        <p class="text-xs text-gray-400">
          <TooltipProvider :delay-duration="0">
            <TooltipRoot>
              <TooltipTrigger as-child>
                <span class="text-yellow-500 underline decoration-dotted cursor-help">Two chains of zones <strong>cannot</strong> be linked together.</span>
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
        <!-- Existing chains list -->
        <div>
          <label class="block text-md text-white mb-1 font-bold">Current chains</label>
          <ul v-if="chains.length > 0" class="flex flex-col gap-2">
            <li
              v-for="chain in chains"
              :key="chain.id"
              class="relative flex flex-col gap-2 bg-gray-800 border border-gray-700 rounded px-3 py-2"
            >
            <div class="flex items-center justify-between gap-2">
              <!-- Colour picker popover, anchored above the chain row. -->
              <div
                v-if="colourPickerChainId === chain.id"
                class="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 bg-gray-950 border border-gray-700 rounded-lg shadow-lg p-2 flex items-center justify-center gap-2 z-10 w-max"
                @click.stop
              >
                <button
                  v-for="c in PICKER_COLOURS"
                  :key="c.hex"
                  :title="c.name"
                  class="w-6 h-6 rounded-full border-2 border-gray-700 hover:border-white transition-colors"
                  :style="{ backgroundColor: c.hex }"
                  @click="chooseColour(chain.id, c.hex)"
                ></button>
              </div>

              <div class="flex items-center gap-2 min-w-0">
                <span class="text-white truncate">{{ zoneName(chain.sourceZoneId) }}</span>
                <ChainIdPill
                  :zone-id="chain.sourceZoneId"
                  :on-click="() => toggleColourPicker(chain.id)"
                  :title="`Change colour for chain #${store.chainFriendlyId(chain.id) ?? '?'}`"
                />
              </div>
              <div class="flex items-center gap-1 flex-shrink-0">
                <button
                  v-if="chain.sourceZoneId !== primaryHomeZoneId"
                  :disabled="removingChainId === chain.id"
                  class="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Delete this chain and all of its zones"
                  @click="removeChain(chain.id, chain.sourceZoneId)"
                >
                  {{ removingChainId === chain.id ? 'Deleting…' : '🗑' }}
                </button>
                <button
                  :disabled="relocatingChainId === chain.id"
                  class="px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1"
                  title="Relocate this chain's home zone (wipes the chain)"
                  @click="toggleRelocatePicker(chain.id)"
                >
                  <span aria-hidden="true">↪</span>
                  <span>{{ relocatingChainId === chain.id ? 'Moving…' : 'Relocate' }}</span>
                </button>
              </div>
            </div>
            <div
              v-if="relocatePickerChainId === chain.id"
              class="flex flex-col gap-2 border-t border-gray-700 pt-2"
            >
              <p class="text-xs text-orange-300">
                ⚠ Relocating will delete every zone and connection currently in this chain.
              </p>
              <ZoneCombobox
                v-model="relocateTargetZoneId"
                placeholder="Search new home zone…"
                :show-already-added="false"
                :disabled-ids="disabledZoneIds"
              />
              <div class="flex gap-2 justify-end">
                <button
                  class="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium transition-colors"
                  @click="toggleRelocatePicker(chain.id)"
                >Cancel</button>
                <button
                  :disabled="!relocateTargetZoneId || relocatingChainId === chain.id"
                  class="px-2 py-1 rounded bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  @click="confirmRelocate(chain.id, chain.sourceZoneId)"
                >Move chain</button>
              </div>
            </div>
            </li>
          </ul>
          <p v-else class="text-sm text-red-500">NO CHAINS! THIS SHOULD NOT BE POSSIBLE! CONTACT THE DEV!!!!</p>
        </div>

        <hr class="border-gray-700" />

        <!-- Add new chain -->
        <div>
          <label class="block text-md text-white mb-1 font-bold">Add a new chain</label>
          <ZoneCombobox
            v-model="sourceZoneId"
            placeholder="Search new chain's start zone…"
            :show-already-added="false"
            :disabled-ids="disabledZoneIds"
          />
          <p class="text-xs text-gray-500 mt-1">
            Pick any zone to start a new independent chain in this room.
          </p>
        </div>

        <p v-if="error" class="text-red-400 text-sm">{{ error }}</p>
        <p v-if="success" class="text-green-400 text-sm">Chain added!</p>

        <div class="flex gap-2">
                    <button
            class="flex-1 px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-white font-medium transition-colors"
            @click="close"
          >
            Close
          </button>
          <button
            :disabled="saving || !sourceZoneId"
            class="flex-1 px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="save"
          >
            {{ saving ? 'Adding…' : 'Place chain…' }}
          </button>
        </div>
      </div>
    </div>
  </div>
  </Teleport>
</template>
