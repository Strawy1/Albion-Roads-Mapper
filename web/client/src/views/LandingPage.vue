<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import CreateRoomModal from '../components/CreateRoomModal.vue';
import CopyrightNotice from '../components/CopyrightNotice.vue';
import RecentlyViewedRooms from '../components/RecentlyViewedRooms.vue';

const route = useRoute();

const showCreate = ref(false);

const videoRef = ref<HTMLVideoElement | null>(null);
const currentTime = ref(0);

interface Chapter {
  name: string;
  start: number;
  end: number;
}

const chapters: Chapter[] = [
  { name: "Adding Zones", start: 0, end: 30 },
  { name: "Rotating Maps & Portal Edits", start: 30, end: 50 },
  { name: "Link Zone Portal", start: 50, end: 81 },
  { name: "Editing Connections", start: 81, end: 91 },
  { name: "Map Features", start: 91, end: 129 },
  { name: "Map History", start: 129, end: 148 },
  { name: "Cores, Chests & Dungeons", start: 148, end: 206 },
  { name: "Links Expiry", start: 206, end: 235 },
  { name: "Search", start: 235, end: 250 },
  { name: "Pinging & Reds", start: 250, end: 278 },
  { name: "Real-Time Sync", start: 278, end: 305 },
  { name: "Route Plotting", start: 305, end: 333 },
  { name: "Room History", start: 333, end: 360 },
  { name: "Room Management", start: 360, end: 999 },
];

const activeChapterName = computed(() => {
  const chapter = chapters.find(c => currentTime.value >= c.start && currentTime.value < c.end);
  return chapter ? chapter.name : chapters[0].name;
});

const dropdownValue = ref<string>(chapters[0].name);
const isMuted = ref(true);

const toggleMute = () => {
  if (videoRef.value) {
    videoRef.value.muted = !videoRef.value.muted;
    isMuted.value = videoRef.value.muted;
  }
};

let animationFrameId: number | null = null;

const updateTimeLoop = () => {
  if (videoRef.value) {
    currentTime.value = videoRef.value.currentTime;
    animationFrameId = requestAnimationFrame(updateTimeLoop);
  }
};

const startAnimation = () => {
  if (!animationFrameId) {
    updateTimeLoop();
  }
};

const stopAnimation = () => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
};

const jumpToChapter = (chapter: Chapter) => {
  if (videoRef.value) {
    videoRef.value.currentTime = chapter.start;
    const offset = 10;
    const elementPosition = videoRef.value.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.scrollY - offset;

    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth'
    });
  }
};

const onChapterChange = (event: Event) => {
  const target = event.target as HTMLSelectElement;
  const selectedName = target.value;
  dropdownValue.value = selectedName;
  const chapter = chapters.find(c => c.name === selectedName);
  if (chapter) {
    jumpToChapter(chapter);
  }
};

const getChapterProgress = (chapter: Chapter) => {
  if (currentTime.value <= chapter.start) return '0%';
  if (currentTime.value >= chapter.end) return '100%';
  const duration = chapter.end - chapter.start;
  return ((currentTime.value - chapter.start) / duration) * 100 + '%';
};

const videoSrc = `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/media/demov1-1.mp4`;

function openCreateRoom() {
  showCreate.value = true;
}

watch(activeChapterName, (name) => {
  dropdownValue.value = name;
});

watch(() => route.query.create, (val) => {
  if (val === 'true') {
    openCreateRoom();
  }
});

onMounted(() => {
  if (videoRef.value) {
    startAnimation();
  }
  if (route.query.create === 'true') {
    openCreateRoom();
  }
});
</script>Improved the landing page a little bit

<style scoped>
.btn-pulsate {
  animation: pulsate 5s ease-in-out infinite;
}

@keyframes pulsate {
  0%, 100% { box-shadow: 0 4px 32px 8px rgba(99, 102, 241, 1); }
  50% { box-shadow: 0 4px 32px 8px rgba(99, 102, 241, 0.4); }
}
</style>

<template>
  <div class="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-start pt-4">
     <div class="w-full max-w-md md:max-w-3xl flex flex-col gap-4 items-center">
      <h1 class="text-4xl font-bold text-indigo-600 text-center">Albion Online Roads Mapper</h1>
      <RecentlyViewedRooms />
      <p class="text-white text-center">
        Collaborate with your guildmates in <b>real-time</b> to track Roads of Avalon portal zones and map content. Locate and track Cores and Treasure Chests with real time-timers, Map Resources (and sizes), Avalonian Chests, and easily find connections to the Royal Continent, Outlands portals and rest zones.
      </p>
      <p class="text-white text-center">
        All Rooms are secured with a password, which you can rotate at any time.
      </p>
       <p class="text-gray-400 text-center">Created by <a href="https://discord.gg/t372jvcsZn" class="text-indigo-400 hover:underline" target="_blank">[DIG]</a> <a href="https://github.com/Maelstromeous/Maelstromeous" class="text-indigo-400 hover:underline" target="_blank">Maelstrome</a></p>
    </div>

    <div class="flex flex-col items-center gap-6 mb-4 mt-4">
        <button
          class="px-10 py-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 border border-blue-400 hover:border-blue-300 font-bold text-xl transition-colors duration-500 btn-pulsate"
          @click="openCreateRoom()"
        >
          Create Room
        </button>
        <div class="flex gap-2">
           <a
          href="https://discord.gg/uFq2PJuZ3r"
          target="_blank"
          class="px-4 py-1.5 rounded-lg bg-[#5865F2] hover:bg-indigo-500 border border-transparent hover:border hover:border-blue-300 font-medium text-sm transition-colors text-center duration-500"
        >
          Discord
        </a>
        <a
          href="https://github.com/dignityofwar/albion-mapper"
          target="_blank"
          class="px-4 py-1.5 rounded-lg bg-gray-600 hover:bg-gray-500 border border-transparent hover:border hover:border-gray-300 font-medium text-sm transition-colors text-center duration-500"
        >
          GitHub
        </a>
        </div>

      </div>
    <div class="w-full max-w-[2000px] mt-4 min-[1200px]:mt-0 min-[1200px]:px-24 min-[1200px]:pt-4 pb-10 overflow-hidden">
      <div class="mb-2 w-full px-4 min-[1200px]:px-0 text-center">
        <button
          @click="toggleMute"
          class="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 font-medium transition-colors text-sm"
        >
          {{ isMuted ? '🔇 Unmute' : '🔊 Mute' }}
        </button>
      </div>
      <div class="mb-4 w-full px-4 min-[1200px]:px-0 text-center">
        <select
          :value="dropdownValue"
          @change="onChapterChange"
          @focus="stopAnimation"
          @blur="startAnimation"
          class="min-[1200px]:hidden w-64 mb-4 p-3 bg-gray-900 text-white rounded-lg border border-gray-700 text-center"
        >
          <option v-for="chapter in chapters" :key="chapter.name" :value="chapter.name">
            {{ chapter.name }}
          </option>
        </select>
        <div class="hidden min-[1200px]:flex gap-2 flex-wrap max-w-full">
          <template v-for="(chapter, index) in chapters" :key="chapter.name">
            <div v-if="index === 7" class="w-full min-[1700px]:hidden"></div>
            <button
              class="flex-1 flex flex-col gap-1 cursor-pointer group"
              @click="jumpToChapter(chapter)"
            >
              <div class="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  class="bg-indigo-500 h-full transition-all duration-300 ease-linear"
                  :style="{ width: getChapterProgress(chapter) }"
                ></div>
              </div>
              <div
                class="w-full text-xs text-center truncate transition-colors group-hover:text-white"
                :class="currentTime >= chapter.start && currentTime < chapter.end ? 'text-white' : 'text-gray-500'"
              >
                {{ chapter.name }}
              </div>
            </button>
          </template>
        </div>
      </div>
      <video
        ref="videoRef"
        :src="videoSrc"
        autoplay
        loop
        muted
        playsinline
        controls
        @play="startAnimation"
        @pause="stopAnimation"
        @ended="stopAnimation"
        class="w-full min-[1200px]:border-2 min-[1200px]:border-gray-500 min-[1200px]:rounded-lg"
      />
    </div>
  </div>
  <CreateRoomModal v-if="showCreate" @close="showCreate = false" />
  <div class="fixed bottom-2 left-0 right-0 text-center pointer-events-none">
    <CopyrightNotice />
  </div>
</template>
