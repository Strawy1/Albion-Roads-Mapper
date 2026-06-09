<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import {
  ComboboxRoot,
  ComboboxInput,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxViewport,
  ComboboxItem,
  ComboboxItemIndicator,
  TooltipProvider,
} from 'reka-ui';
import { ZONES } from 'shared';
import type { Zone } from 'shared';
import { useRoomStore } from '@/stores/useRoomStore';
import ZoneComboItem from './common/ZoneComboItem.vue';

const props = withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
  excludedIds?: string[];
  disabledIds?: string[];
  showAlreadyAdded?: boolean;
  smartAlreadyAdded?: boolean;
  alreadyAddedPlacement?: 'top' | 'bottom';
  error?: boolean;
  disabled?: boolean;
  icon?: string;
  onlyRoadsHideout?: boolean;
  variant?: 'default' | 'underline';
}>(), {
  showAlreadyAdded: true,
  smartAlreadyAdded: false,
  alreadyAddedPlacement: 'bottom',
  disabled: false,
  onlyRoadsHideout: false,
  variant: 'default',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  tabSelect: [];
  select: [];
}>();

const store = useRoomStore();
const query = ref('');
const comboboxInput = ref<any>(null);
const comboboxWrapper = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const highlightedId = ref<string | null>(null);
const singleResultId = ref<string | null>(null);
const isFlashing = ref(false);

const selectedZone = computed<Zone | undefined>(() =>
  props.modelValue ? ZONES.find((z) => z.id === props.modelValue) : undefined
);

// Zone IDs that appear in any current connection
const mappedZoneIds = computed<Set<string>>(() => {
  const ids = new Set<string>();
  for (const c of store.connections) {
    ids.add(c.fromZoneId);
    ids.add(c.toZoneId);
  }
  return ids;
});

const disabledIdsSet = computed<Set<string>>(() => new Set(props.disabledIds ?? []));

const filteredZones = computed<Zone[]>(() => {
  const q = query.value.toLowerCase().trim();
  let zones = ZONES.filter((z) => {
    if (props.onlyRoadsHideout && !z.isRoadsHome) return false;
    if (props.excludedIds && props.excludedIds.includes(z.id)) return false;
    if (props.showAlreadyAdded === false && mappedZoneIds.value.has(z.id) && !disabledIdsSet.value.has(z.id)) return false;
    // disabledIds zones only appear when the user has typed a query that matches them
    if (disabledIdsSet.value.has(z.id)) return !!q && z.name.toLowerCase().includes(q);
    if (props.smartAlreadyAdded && !q && mappedZoneIds.value.has(z.id)) return false;
    
    if (!q) {
      if (props.onlyRoadsHideout) return true;
      return mappedZoneIds.value.has(z.id) || z.id === store.homeZoneId;
    }

    return (
      z.name.toLowerCase().includes(q)
    );
  });

  if (props.smartAlreadyAdded) {
    zones.sort((a, b) => {
      const aHome = a.id === store.homeZoneId;
      const bHome = b.id === store.homeZoneId;
      if (aHome && !bHome) return -1;
      if (!aHome && bHome) return 1;

      if (q) {
        const aMapped = mappedZoneIds.value.has(a.id);
        const bMapped = mappedZoneIds.value.has(b.id);
        if (aMapped === bMapped) return 0;
        const direction = props.alreadyAddedPlacement === 'top' ? -1 : 1;
        return aMapped ? direction : -direction;
      }
      return 0;
    });
  }

  return zones.slice(0, 100);
});

defineExpose({
  focus: () => {
    comboboxInput.value?.$el?.focus();
  },
  flash: () => {
    isFlashing.value = true;
    setTimeout(() => {
      isFlashing.value = false;
    }, 1000);
  },
  /** Exposed for testing only: mutate query and read filtered results from within the component closure */
  setTestQuery: (val: string) => { query.value = val; },
  getTestFilteredZones: () => filteredZones.value,
  triggerTabKeydown: () => {
    // Ensure singleResultId is in sync before firing Tab (watch is async in tests)
    const nonDisabled = filteredZones.value.filter((z) => !disabledIdsSet.value.has(z.id));
    singleResultId.value = nonDisabled.length === 1 ? nonDisabled[0].id : null;
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    onWrapperKeydown(e);
  },
});

// Track a single non-disabled result so Tab can accept it even before reka-ui highlights it
watch(filteredZones, (zones) => {
  const nonDisabled = zones.filter((z) => !disabledIdsSet.value.has(z.id));
  singleResultId.value = nonDisabled.length === 1 ? nonDisabled[0].id : null;
});

/** Convert a stored zone ID back to the friendly display name for the input */
function displayValue(id: unknown): string {
  if (!id || typeof id !== 'string') return '';
  return ZONES.find((z) => z.id === id)?.name ?? id;
}

function onSelect(val: string | null) {
  if (val !== null) {
    emit('update:modelValue', val);
    emit('select');
    query.value = '';
  }
}

/** highlight payload: { ref: HTMLElement, value: string } | undefined */
function onHighlight(payload: unknown) {
  if (payload && typeof (payload as { value: string }).value === 'string') {
    highlightedId.value = (payload as { value: string }).value;
  } else {
    highlightedId.value = null;
  }
}

function onInputFocus() {
  query.value = '';
  isOpen.value = true;
}

function onInputBlur(_e: FocusEvent) {
  // onWrapperKeydown never fires for Tab (reka-ui or browser eats it before capture).
  // Instead, commit the highlighted or single result here on blur — covers both
  // arrow-key navigation and single-result Tab. Enter is already handled by
  // reka-ui's own onSelect path.
  const id = highlightedId.value ?? singleResultId.value;
  if (id) {
    emit('update:modelValue', id);
    query.value = '';
    highlightedId.value = null;
  }
}

/**
 * Capture Tab on the wrapper so we intercept before reka-ui's own keydown
 * handlers (which only cover Up/Down). When a dropdown item is highlighted we
 * accept it and move focus to the next field.
 */
function onWrapperKeydown(e: KeyboardEvent) {
  if (e.key !== 'Tab' && e.key !== 'Enter') return;
  const id = highlightedId.value ?? (e.key === 'Tab' ? singleResultId.value : null);
  if (!id) return;
  e.preventDefault();
  emit('update:modelValue', id);
  query.value = '';
  highlightedId.value = null;
  if (e.key === 'Tab') {
    emit('tabSelect');
  } else {
    emit('select');
  }
}
</script>

<template>
  <!-- capture Tab on the wrapper before reka-ui's internal listeners fire -->
  <TooltipProvider :delay-duration="300">
  <div ref="comboboxWrapper" class="relative" @keydown.capture="onWrapperKeydown">
    <ComboboxRoot
      :model-value="modelValue"
      v-model:open="isOpen"
      @update:model-value="onSelect"
      @highlight="onHighlight"
      :ignore-filter="true"
      :disabled="disabled"
      data-testid="zone-combobox"
    >
      <div 
        :class="[
          variant === 'underline'
            ? ['flex items-center text-white py-1 px-1 -mx-1 hover:rounded transition-colors border-b hover:border-transparent hover:bg-gray-700/40', error ? 'border-dashed border-red-500' : (modelValue ? 'border-green-500' : 'border-dashed border-gray-500'), isFlashing ? 'flash-animation' : '', disabled ? 'cursor-not-allowed text-gray-400' : '']
            : ['flex items-center border rounded bg-gray-800 text-white px-3 py-2.5 md:py-2 transition-colors focus-within:border-white', error ? 'border-red-500' : (isFlashing ? 'border-indigo-400' : 'border-gray-600'), isFlashing ? 'flash-animation' : '', disabled ? 'cursor-not-allowed text-gray-400' : '']
        ]"
      >
        <span v-if="icon" class="mr-2 text-sm leading-none shrink-0">{{ icon }}</span>
        <!-- Selected zone display (shown when a zone is chosen and dropdown is closed) -->
        <div
          v-if="selectedZone && !isOpen"
          class="flex-1 flex items-center gap-2 min-w-0 cursor-text"
          @click="() => { comboboxInput.$el?.focus(); }"
        >
          <ZoneComboItem :zone="selectedZone" />
        </div>
        <ComboboxInput
          ref="comboboxInput"
          v-model="query"
          :display-value="displayValue"
          :placeholder="placeholder ?? 'Search zones…'"
          class="bg-transparent py-0 outline-none text-base leading-none min-w-0"
          :class="[
            disabled ? 'cursor-not-allowed opacity-75' : '',
            selectedZone && !isOpen ? 'w-0 opacity-0 absolute' : 'flex-1'
          ]"
          data-testid="zone-combobox-input"
          @focus="onInputFocus"
          @blur="onInputBlur"
        />
        <ComboboxTrigger 
          v-if="variant !== 'underline'"
          class="pl-3 py-0 text-gray-400 text-sm leading-none"
          :class="disabled ? 'cursor-not-allowed' : 'hover:text-white'"
          :disabled="disabled"
        >
          ▾
        </ComboboxTrigger>
      </div>

      <ComboboxContent
        class="absolute z-50 mt-1 w-full bg-gray-900 border border-gray-600 rounded shadow-lg max-h-64 overflow-hidden"
      >
        <ComboboxViewport class="overflow-y-auto max-h-64">
          <div v-if="filteredZones.length === 0" class="px-3 py-2 text-sm text-gray-400">
            {{ query ? 'No zones found' : 'Type to search all zones…' }}
          </div>
          <ComboboxItem
            v-for="zone in filteredZones"
            :key="zone.id"
            :value="zone.id"
            :disabled="disabledIdsSet.has(zone.id)"
            class="flex items-center gap-2 px-3 py-2 text-sm transition-colors"
            :class="[
              disabledIdsSet.has(zone.id)
                ? 'opacity-50 cursor-not-allowed text-white bg-green-900/40'
                : (mappedZoneIds.has(zone.id) && zone.id !== modelValue
                    ? 'text-white cursor-pointer bg-green-900/40 hover:bg-green-900/60 data-[highlighted]:bg-gray-700'
                    : 'text-white cursor-pointer hover:bg-gray-700 data-[highlighted]:bg-gray-700')
            ]"
          >
            <ZoneComboItem :zone="zone" />
            <span v-if="disabledIdsSet.has(zone.id)" class="shrink-0 text-green-400">✓</span>
            <ComboboxItemIndicator v-else class="shrink-0 text-green-400">✓</ComboboxItemIndicator>
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxRoot>
  </div>
  </TooltipProvider>
</template>
