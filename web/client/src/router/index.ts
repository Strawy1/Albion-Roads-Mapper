import { createRouter, createWebHistory } from 'vue-router';
import LandingPage from '../views/LandingPage.vue';
import CreateRoomView from '../views/CreateRoomView.vue';
import RoomView from '../views/RoomView.vue';
import RoomAuthView from '../views/RoomAuthView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: LandingPage },
    { path: '/create', component: CreateRoomView },
    { path: '/rooms/:id/auth', component: RoomAuthView, props: true },
    { path: '/rooms/:id', component: RoomView, props: true },
  ],
});
