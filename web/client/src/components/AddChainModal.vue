<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoomStore } from '../stores/useRoomStore';
import { track } from '@vercel/analytics';
import { Z_INDEX } from '@/constants/Layers';
import { ZONE_BY_ID, CHAIN_COLOR_PALETTE } from 'shared';
import ZoneCombobox from './ZoneCombobox.vue';

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

// When non-null, the colour-picker popover is shown above that chain row.
const colourPickerChainId = ref<string | null>(null);

const chains = computed(() => store.chains);
const primaryHomeZoneId = computed(() => store.homeZoneId);

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

async function save() {
  if (!sourceZoneId.value) {
    error.value = 'Choose a zone';
    return;
  }

  saving.value = true;
  error.value = '';
  success.value = false;
  try {
    await store.addChain(sourceZoneId.value);
    success.value = true;
    track('add_chain');
    sourceZoneId.value = '';
    setTimeout(() => { success.value = false; }, 1500);
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to add chain';
  } finally {
    saving.value = false;
  }
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

function chainPillColour(chain: { chainColor?: string }): string {
  return chain.chainColor ?? CHAIN_COLOR_PALETTE[0];
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
      <h2 class="text-xl font-semibold mb-4 text-white">Chains</h2>

      <div class="flex flex-col gap-4">
        <p class="text-xs text-gray-500">Chains are a means to create multiple seperated groups of zones, each having a source zone. This is useful in the case you're exploring outwards from Black Zones into Roads.</p>
        <!-- Existing chains list -->
        <div>
          <label class="block text-sm text-gray-400 mb-2">Current chains</label>
          <ul v-if="chains.length > 0" class="flex flex-col gap-2">
            <li
              v-for="chain in chains"
              :key="chain.id"
              class="relative flex items-center justify-between gap-2 bg-gray-800 border border-gray-700 rounded px-3 py-2"
            >
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
                <button
                  type="button"
                  class="text-xs flex-shrink-0 rounded px-1.5 py-0.5 border inline-flex items-center gap-1 cursor-pointer hover:bg-gray-700 transition-colors"
                  :style="{ color: chainPillColour(chain), borderColor: chainPillColour(chain) }"
                  :title="`Change colour for chain #${store.chainFriendlyId(chain.id) ?? '?'}`"
                  @click.stop="toggleColourPicker(chain.id)"
                ><span aria-hidden="true">⛓</span><span>{{ store.chainFriendlyId(chain.id) ?? '?' }}</span></button>
              </div>
              <button
                v-if="chain.sourceZoneId !== primaryHomeZoneId"
                :disabled="removingChainId === chain.id"
                class="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                title="Delete this chain and all of its zones"
                @click="removeChain(chain.id, chain.sourceZoneId)"
              >
                {{ removingChainId === chain.id ? 'Deleting…' : '🗑 Delete' }}
              </button>
              <span
                v-else
                class="text-[10px] text-gray-500 flex-shrink-0"
                title="The primary chain cannot be deleted"
              >cannot delete</span>
            </li>
          </ul>
          <p v-else class="text-sm text-gray-500 italic">No chains yet.</p>
        </div>

        <hr class="border-gray-700" />

        <!-- Add new chain -->
        <div>
          <label class="block text-sm text-gray-400 mb-1">Add a new chain</label>
          <ZoneCombobox
            v-model="sourceZoneId"
            placeholder="Search new chain's start zone…"
            :show-already-added="false"
          />
          <p class="text-xs text-gray-500 mt-1">
            Pick any zone to start a new independent chain in this room. New chains never share
            connections with existing ones.
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
            {{ saving ? 'Adding…' : 'Add chain' }}
          </button>

        </div>
      </div>
    </div>
  </div>
  </Teleport>
</template>
