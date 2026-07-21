<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
// @ts-ignore
import VueKofi from 'vue-kofi';
import { sendEvent } from '@/utils/events';

// Where this button is rendered — determines the click analytics event and
// whether the attention-grabbing jiggle runs (planner toolbar only).
const props = withDefaults(defineProps<{ source?: 'planner' | 'modal' }>(), {
  source: 'planner',
});

const emit = defineEmits<{ clicked: [] }>();

const isJiggling = ref(false);
const kofiColor = ref('#4338ca');
let jiggleInterval: ReturnType<typeof setInterval> | null = null;

function triggerJiggle() {
  if (localStorage.getItem('tippedNavigator')) return;
  isJiggling.value = true;
  kofiColor.value = '#4338ca';
  setTimeout(() => (kofiColor.value = '#126f9c'), 100);
  setTimeout(() => (kofiColor.value = '#4338ca'), 1600);
  setTimeout(() => (isJiggling.value = false), 2000);
}

onMounted(() => {
  if (props.source !== 'planner') return;
  triggerJiggle();
  jiggleInterval = setInterval(triggerJiggle, 60000);
});

onUnmounted(() => {
  if (jiggleInterval) clearInterval(jiggleInterval);
});

function handleKoFiClick() {
  localStorage.setItem('tippedNavigator', 'true');
  isJiggling.value = false;
  sendEvent(props.source === 'modal' ? 'donation_modal_clicked' : 'donation_planner_clicked');
  emit('clicked');
}
</script>

<template>
  <div
    class="tip-button cursor-pointer"
    :class="{ 'jiggle': isJiggling }"
    @click="handleKoFiClick"
  >
    <VueKofi 
      class="kofi-button"
      uid="K3K5156KXP" 
      :color="kofiColor" 
      text="Tip the Navigator!" 
    />
  </div>
</template>

<style scoped>
@keyframes jiggle {
  0% { transform: rotate(0deg); }
  20% { transform: rotate(0deg); }
  30% { transform: rotate(-3deg); }
  40% { transform: rotate(3deg); }
  50% { transform: rotate(-3deg); }
  60% { transform: rotate(3deg); }
  80% { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}

.jiggle {
  animation: jiggle 2s ease-in-out;
}

.kofi-button, .kofi-button :deep(*) {
  transition: background-color 1s ease-in-out, color 1s ease-in-out !important;
}

.kofi-button:hover, .kofi-button:hover :deep(*) {
  background-color: #126f9c !important;
  transition: background-color 0.2s ease-in-out, color 0.2s ease-in-out !important;
}

</style>
