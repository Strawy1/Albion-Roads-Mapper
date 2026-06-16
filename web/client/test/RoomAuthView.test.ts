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

describe('RoomAuthView — room not found', () => {
  it('shows the not-found state and auto-deletion message when ?reason=room_not_found', async () => {
    mockRouteQuery.mockReturnValue({ reason: 'room_not_found' });

    const wrapper = mount(RoomAuthView, {
      props: { id: 'test-room' },
    });

    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Room not found!');
    expect(wrapper.text()).toContain('automatically deleted');
    expect(wrapper.text()).toContain('recreate it under the same link');

    wrapper.unmount();
  });

  it('shows the owner-deleted banner when ?reason=room_deleted', async () => {
    mockRouteQuery.mockReturnValue({ reason: 'room_deleted' });

    const wrapper = mount(RoomAuthView, {
      props: { id: 'test-room' },
    });

    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Room not found!');
    expect(wrapper.text()).toContain('Room was deleted!');
    expect(wrapper.text()).toContain('permanently deleted this room');
    expect(wrapper.text()).not.toContain('automatically deleted');

    wrapper.unmount();
  });

  it('shows the not-found state and auto-deletion message when the room 404s directly', async () => {
    mockRouteQuery.mockReturnValue({});
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 404,
      ok: false,
      json: () => Promise.resolve({}),
    } as Response);

    const wrapper = mount(RoomAuthView, {
      props: { id: 'missing-room' },
    });

    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Room not found!');
    expect(wrapper.text()).toContain('automatically deleted');
    expect(wrapper.text()).toContain('recreate it under the same link');

    wrapper.unmount();
  });
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
