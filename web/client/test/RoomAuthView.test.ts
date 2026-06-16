import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import RoomAuthView from '../src/views/RoomAuthView.vue';

// Mock @vercel/analytics so we don't need the real SDK in tests
vi.mock('@vercel/analytics', () => ({
  track: vi.fn(),
}));

// Mock vue-router — route.query is overridden per describe block below
const mockRouteQuery = vi.fn(() => ({}));

vi.mock('vue-router', () => ({
  useRouter: () => ({
    replace: vi.fn(() => Promise.resolve()),
    push: vi.fn(() => Promise.resolve()),
  }),
  useRoute: () => ({
    query: mockRouteQuery(),
  }),
}));

// Prevent onMounted from calling the real fetch or touching localStorage
vi.mock('../src/utils/api', () => ({
  API_BASE_URL: 'http://localhost',
}));

// Stub out global fetch so the room-check on mount doesn't fail
global.fetch = vi.fn(() =>
  Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({}) } as Response),
);

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
});

describe('RoomAuthView — session_expired banner', () => {
  it('shows the session expired banner when ?reason=session_expired is in the query', async () => {
    mockRouteQuery.mockReturnValue({ reason: 'session_expired' });

    const wrapper = mount(RoomAuthView, {
      props: { id: 'test-room' },
    });

    // Wait for onMounted async work to settle
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Session expired.');
    expect(wrapper.text()).toContain('Please log in again to continue.');

    wrapper.unmount();
  });

  it('does NOT show the session expired banner when there is no reason query param', async () => {
    mockRouteQuery.mockReturnValue({});

    const wrapper = mount(RoomAuthView, {
      props: { id: 'test-room' },
    });

    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).not.toContain('Session expired.');

    wrapper.unmount();
  });

  it('does NOT show the session expired banner when a different reason is present', async () => {
    mockRouteQuery.mockReturnValue({ reason: 'password_rotated' });

    const wrapper = mount(RoomAuthView, {
      props: { id: 'test-room' },
    });

    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).not.toContain('Session expired.');
    expect(wrapper.text()).toContain('Room password has been rotated.');

    wrapper.unmount();
  });
});
