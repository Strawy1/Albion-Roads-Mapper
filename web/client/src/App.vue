<script setup lang="ts">
import { RouterView } from 'vue-router';
import { Analytics } from '@vercel/analytics/vue';
import { useVersionWatch } from '@/composables/useVersionWatch';
import UpdateAvailableToast from '@/components/UpdateAvailableToast.vue';

const isProd = import.meta.env.PROD;

// Prompt every open tab (room or not) to reload when a new build is released.
const { updateAvailable, reload } = useVersionWatch();
</script>

<template>
  <Analytics v-if="isProd" />
  <RouterView />
  <UpdateAvailableToast :show="updateAvailable" @reload="reload" />
</template>
