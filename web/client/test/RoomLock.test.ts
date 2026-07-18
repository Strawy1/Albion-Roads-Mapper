import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { useRoomStore } from '@/stores/useRoomStore';
import LockRoomModal from '../src/components/LockRoomModal.vue';
import LockedRoomFrame from '../src/components/room/LockedRoomFrame.vue';
import RoomSettings from '../src/components/RoomSettings.vue';

// Mock WebSocket — the lock flow reconnects the socket after swapping tokens.
(global as any).WebSocket = class {
  static OPEN = 1;
  readyState = 0;
  send() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
};

/** Unsigned JWT with the given payload — for client-side display decoding only. */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.fakesig`;
}

const ROOM_ID = 'room123';
const REGULAR_TOKEN = fakeJwt({ roomId: ROOM_ID, passwordVersion: 1 });
const ADMIN_TOKEN = fakeJwt({ roomId: ROOM_ID, passwordVersion: 1, role: 'admin' });

function minimalSync(extra: Record<string, unknown> = {}) {
  return {
    type: 'sync',
    connections: [],
    homeZoneId: 'zone-a',
    nodePositions: [],
    lastUpdatedAt: new Date().toISOString(),
    watching: 1,
    totalConnected: 1,
    ...extra,
  } as any;
}

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useRoomStore — lock state', () => {
  it('sync applies the locked flag (and defaults to unlocked when absent)', () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);

    store.applyMessage(minimalSync({ locked: true }));
    expect(store.locked).toBe(true);

    store.applyMessage(minimalSync());
    expect(store.locked).toBe(false);
  });

  it('room_lock_changed toggles the locked flag live', () => {
    const store = useRoomStore();
    store.applyMessage({ type: 'room_lock_changed', locked: true } as any);
    expect(store.locked).toBe(true);
    store.applyMessage({ type: 'room_lock_changed', locked: false } as any);
    expect(store.locked).toBe(false);
  });

  it('canEdit is false for regular tokens in a locked room, true for admin tokens', () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);
    store.applyMessage(minimalSync({ locked: true }));

    expect(store.isAdmin).toBe(false);
    expect(store.canEdit).toBe(false);

    store.setCredentials(ROOM_ID, ADMIN_TOKEN);
    expect(store.isAdmin).toBe(true);
    expect(store.canEdit).toBe(true);
  });

  it('canEdit is true in an unlocked room regardless of role', () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);
    store.applyMessage(minimalSync({ locked: false }));
    expect(store.canEdit).toBe(true);
  });

  it('a malformed token never reads as admin', () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, 'not-a-jwt');
    expect(store.isAdmin).toBe(false);
  });

  it('disconnect clears locked and admin state', () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, ADMIN_TOKEN);
    store.applyMessage(minimalSync({ locked: true }));
    store.disconnect();
    expect(store.locked).toBe(false);
    expect(store.isAdmin).toBe(false);
  });

  it('adminAuthenticate swaps the stored token for the admin token (old token is gone)', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: ADMIN_TOKEN }),
    } as Response);

    const res = await store.adminAuthenticate('admin-secret');
    expect(res.ok).toBe(true);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/rooms/${ROOM_ID}/auth/admin`),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ adminPassword: 'admin-secret' }) }),
    );
    // Exactly one token per room, and it is now the admin one.
    expect(localStorage.getItem(`token:${ROOM_ID}`)).toBe(ADMIN_TOKEN);
    expect(store.isAdmin).toBe(true);
  });

  it('adminAuthenticate surfaces server errors and keeps the old token', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Invalid admin password' }),
    } as Response);

    const res = await store.adminAuthenticate('wrong');
    expect(res).toEqual({ ok: false, error: 'Invalid admin password' });
    expect(localStorage.getItem(`token:${ROOM_ID}`)).toBe(REGULAR_TOKEN);
    expect(store.isAdmin).toBe(false);
  });

  it('setRoomLock PATCHes the lock endpoint with the bearer token and updates local state', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, ADMIN_TOKEN);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, locked: true }),
    } as Response);

    const res = await store.setRoomLock(true);
    expect(res.ok).toBe(true);
    expect(store.locked).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/rooms/${ROOM_ID}/lock`),
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ Authorization: `Bearer ${ADMIN_TOKEN}` }),
        body: JSON.stringify({ locked: true }),
      }),
    );
  });

  it('setRoomLock does not flip local state when the server refuses', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Admin token required' }),
    } as Response);

    const res = await store.setRoomLock(true);
    expect(res).toEqual({ ok: false, error: 'Admin token required' });
    expect(store.locked).toBe(false);
  });
});

describe('LockRoomModal', () => {
  function mockLockEndpoints() {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/auth/admin')) {
        return { ok: true, json: async () => ({ token: ADMIN_TOKEN }) } as Response;
      }
      if (String(url).includes('/lock')) {
        return { ok: true, json: async () => ({ ok: true, locked: true }) } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  }

  async function flush() {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }

  it('locks the room after admin auth and confirms admin mode', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);
    mockLockEndpoints();

    const wrapper = mount(LockRoomModal, { props: { modelValue: true } });
    const modal = document.querySelector('[data-testid="lock-room-modal"]')!;
    expect(modal.textContent).toContain('Lock Room');

    const input = document.querySelector('[data-testid="lock-room-admin-password"]') as HTMLInputElement;
    input.value = 'admin-secret';
    input.dispatchEvent(new Event('input'));
    await nextTick();

    (document.querySelector('[data-testid="lock-room-submit"]') as HTMLButtonElement).click();
    await flush();
    await flush();

    expect(store.locked).toBe(true);
    expect(store.isAdmin).toBe(true);
    expect(localStorage.getItem(`token:${ROOM_ID}`)).toBe(ADMIN_TOKEN);
    const success = document.querySelector('[data-testid="lock-room-success"]');
    expect(success).not.toBeNull();
    expect(success!.textContent).toContain('admin mode');

    wrapper.unmount();
  });

  it('shows the unlock flow when the room is already locked', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, ADMIN_TOKEN);
    store.applyMessage({ type: 'room_lock_changed', locked: true } as any);

    const wrapper = mount(LockRoomModal, { props: { modelValue: true } });
    const modal = document.querySelector('[data-testid="lock-room-modal"]')!;
    expect(modal.textContent).toContain('Unlock Room');
    wrapper.unmount();
  });

  it('surfaces a wrong admin password without changing lock state', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Invalid admin password' }),
    } as Response);

    const wrapper = mount(LockRoomModal, { props: { modelValue: true } });
    const input = document.querySelector('[data-testid="lock-room-admin-password"]') as HTMLInputElement;
    input.value = 'wrong';
    input.dispatchEvent(new Event('input'));
    await nextTick();

    (document.querySelector('[data-testid="lock-room-submit"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();

    expect(store.locked).toBe(false);
    expect(store.isAdmin).toBe(false);
    expect(document.querySelector('[data-testid="lock-room-error"]')!.textContent).toContain('Invalid admin password');

    wrapper.unmount();
  });
});

describe('useRoomStore — read-only enforcement for non-admins in a locked room', () => {
  function lockedViewerStore() {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);
    store.applyMessage(minimalSync({
      locked: true,
      nodePositions: [{ zoneId: 'qiient-al-nusom', x: 10, y: 20, features: { slots: 7 } }],
    }));
    return store;
  }

  it('updateNodeFeatures is fully prevented (no local mutation, nothing sent)', () => {
    const store = lockedViewerStore();
    store.updateNodeFeatures('qiient-al-nusom', { slots: 20 });
    expect(store.nodePositions[0].features).toEqual({ slots: 7 });
  });

  it('updateNodePositionsInStore is fully prevented', () => {
    const store = lockedViewerStore();
    store.updateNodePositionsInStore([{ zoneId: 'qiient-al-nusom', x: 999, y: 999 }]);
    expect(store.nodePositions[0].x).toBe(10);
    expect(store.nodePositions[0].y).toBe(20);
  });

  it('saveZoneHandles / resetZonePortals / markNodeExplored are prevented', () => {
    const store = lockedViewerStore();
    store.saveZoneHandles('qiient-al-nusom', [{ id: 'h1', left: '0%', top: '0%' }]);
    store.resetZonePortals('qiient-al-nusom');
    store.markNodeExplored('qiient-al-nusom');
    expect(store.nodePositions[0].customHandles).toBeUndefined();
    expect(store.nodePositions[0].explored).toBeUndefined();
  });

  it('resetNodePositions is prevented', () => {
    const store = lockedViewerStore();
    store.resetNodePositions();
    expect(store.nodePositions.length).toBe(1);
  });

  it('send() drops mutating WS messages but still allows polo/ping', () => {
    const store = lockedViewerStore();
    const sent: any[] = [];
    // Reach the module-level ws through connect(): stub WebSocket capture.
    (global as any).WebSocket = class {
      static OPEN = 1;
      readyState = 1;
      send(data: string) { sent.push(JSON.parse(data)); }
      close() {}
      addEventListener() {}
      removeEventListener() {}
    };
    store.connect();
    sent.length = 0; // ignore the auth message

    store.send({ type: 'update_plot_route', plottedRoute: ['a'] });
    store.send({ type: 'rotate_zone', zoneId: 'z', rotation: 1 });
    store.send({ type: 'create_connection', fromZoneId: 'a', toZoneId: 'b', secondsRemaining: 60 });
    store.send({ type: 'update_node_positions', nodePositions: [] });
    expect(sent).toEqual([]);

    store.send({ type: 'polo' });
    expect(sent).toEqual([{ type: 'polo' }]);
  });

  it('chain REST actions reject with a locked error before any network call', async () => {
    const store = lockedViewerStore();
    global.fetch = vi.fn();
    await expect(store.addChain('qiient-al-odesum')).rejects.toThrow(/locked/i);
    await expect(store.updateChainColor('c1', '#ff0000')).rejects.toThrow(/locked/i);
    await expect(store.relocateChain('c1', 'qiient-al-odesum')).rejects.toThrow(/locked/i);
    await expect(store.removeChain('c1')).rejects.toThrow(/locked/i);
    await expect(store.importData({ connections: [], nodePositions: [], homeZoneId: 'z' })).rejects.toThrow(/locked/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('admins keep full edit rights while locked', () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, ADMIN_TOKEN);
    store.applyMessage(minimalSync({
      locked: true,
      nodePositions: [{ zoneId: 'qiient-al-nusom', x: 10, y: 20, features: { slots: 7 } }],
    }));
    store.updateNodeFeatures('qiient-al-nusom', { slots: 20 });
    expect(store.nodePositions[0].features?.slots).toBe(20);
  });
});

describe('LockedRoomFrame', () => {
  it('renders nothing when the room is unlocked', () => {
    const wrapper = mount(LockedRoomFrame);
    expect(wrapper.find('[data-testid="locked-room-frame"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="locked-room-badge"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows the yellow frame and Locked badge when locked (viewer)', async () => {
    const store = useRoomStore();
    store.applyMessage({ type: 'room_lock_changed', locked: true } as any);

    const wrapper = mount(LockedRoomFrame);
    await nextTick();
    expect(wrapper.find('[data-testid="locked-room-frame"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="locked-room-badge"]').text()).toContain('Locked');
    // Non-admin viewers must NOT see the admin-mode badge.
    expect(wrapper.find('[data-testid="locked-admin-badge"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('additionally shows the admin-mode warning badge for admins', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, ADMIN_TOKEN);
    store.applyMessage({ type: 'room_lock_changed', locked: true } as any);

    const wrapper = mount(LockedRoomFrame);
    await nextTick();
    expect(wrapper.find('[data-testid="locked-admin-badge"]').text()).toContain('Admin mode');
    wrapper.unmount();
  });

  it('appears live when room_lock_changed arrives after mount (no reload needed)', async () => {
    const store = useRoomStore();
    const wrapper = mount(LockedRoomFrame);
    expect(wrapper.find('[data-testid="locked-room-frame"]').exists()).toBe(false);

    store.applyMessage({ type: 'room_lock_changed', locked: true } as any);
    await nextTick();
    expect(wrapper.find('[data-testid="locked-room-frame"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="locked-room-badge"]').exists()).toBe(true);

    store.applyMessage({ type: 'room_lock_changed', locked: false } as any);
    await nextTick();
    expect(wrapper.find('[data-testid="locked-room-frame"]').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('RoomSettings — lock room entry', () => {
  let attachTo: HTMLDivElement;
  beforeEach(() => {
    attachTo = document.createElement('div');
    document.body.appendChild(attachTo);
  });
  afterEach(() => {
    document.body.removeChild(attachTo);
  });

  it('shows a closed padlock "Lock room" action below Change password when unlocked', async () => {
    const wrapper = mount(RoomSettings, { attachTo });
    await wrapper.find('[data-testid="settings-cog"]').trigger('click');

    const lockToggle = wrapper.find('[data-testid="settings-lock-room-toggle"]');
    expect(lockToggle.exists()).toBe(true);
    expect(lockToggle.text()).toContain('Lock room');
    expect(lockToggle.text()).toContain('🔒');

    // Ordering: the lock entry sits below the change-password entry.
    const popup = wrapper.find('[data-testid="settings-popup"]');
    const html = popup.html();
    expect(html.indexOf('settings-change-password-toggle')).toBeLessThan(html.indexOf('settings-lock-room-toggle'));

    wrapper.unmount();
  });

  it('shows an open padlock "Unlock room" action when locked', async () => {
    const store = useRoomStore();
    store.applyMessage({ type: 'room_lock_changed', locked: true } as any);

    const wrapper = mount(RoomSettings, { attachTo });
    await wrapper.find('[data-testid="settings-cog"]').trigger('click');

    const lockToggle = wrapper.find('[data-testid="settings-lock-room-toggle"]');
    expect(lockToggle.text()).toContain('Unlock room');
    expect(lockToggle.text()).toContain('🔓');

    wrapper.unmount();
  });

  it('opens the lock modal when clicked', async () => {
    const wrapper = mount(RoomSettings, { attachTo });
    await wrapper.find('[data-testid="settings-cog"]').trigger('click');
    await wrapper.find('[data-testid="settings-lock-room-toggle"]').trigger('click');
    await nextTick();

    expect(document.querySelector('[data-testid="lock-room-modal"]')).not.toBeNull();
    wrapper.unmount();
  });
});

describe('RoomView — nodes become non-draggable in a locked room', () => {
  async function mountRoomView() {
    const { createRouter, createMemoryHistory } = await import('vue-router');
    const RoomView = (await import('../src/views/RoomView.vue')).default;
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div/>' } }] });
    return mount(RoomView, {
      props: { id: ROOM_ID },
      global: {
        plugins: [router],
        stubs: {
          ReportForm: true,
          DebugTray: true,
          RoomSettings: true,
          VueFlow: true,
          Background: true,
          Controls: true,
        },
      },
    });
  }

  it('per-node draggable is false for a non-admin viewer while locked', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);
    store.applyMessage(minimalSync({
      homeZoneId: 'other-zone',
      locked: true,
      nodePositions: [{ zoneId: 'qiient-al-nusom', x: 0, y: 0 }],
    }));

    const wrapper = await mountRoomView();
    const vm = wrapper.vm as any;
    const node = vm.flowNodes.find((n: any) => n.id === 'qiient-al-nusom');
    expect(node).toBeDefined();
    expect(node.draggable).toBe(false);
    wrapper.unmount();
  });

  it('nodes lock/unlock live when room_lock_changed arrives (no reload needed)', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);
    store.applyMessage(minimalSync({
      homeZoneId: 'other-zone',
      nodePositions: [{ zoneId: 'qiient-al-nusom', x: 0, y: 0 }],
    }));

    const wrapper = await mountRoomView();
    const vm = wrapper.vm as any;
    expect(vm.flowNodes.find((n: any) => n.id === 'qiient-al-nusom').draggable).toBe(true);

    store.applyMessage({ type: 'room_lock_changed', locked: true } as any);
    await nextTick();
    expect(vm.flowNodes.find((n: any) => n.id === 'qiient-al-nusom').draggable).toBe(false);

    store.applyMessage({ type: 'room_lock_changed', locked: false } as any);
    await nextTick();
    expect(vm.flowNodes.find((n: any) => n.id === 'qiient-al-nusom').draggable).toBe(true);
    wrapper.unmount();
  });

  it('admins keep draggable nodes while locked', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, ADMIN_TOKEN);
    store.applyMessage(minimalSync({
      homeZoneId: 'other-zone',
      locked: true,
      nodePositions: [{ zoneId: 'qiient-al-nusom', x: 0, y: 0 }],
    }));

    const wrapper = await mountRoomView();
    const vm = wrapper.vm as any;
    expect(vm.flowNodes.find((n: any) => n.id === 'qiient-al-nusom').draggable).toBe(true);
    wrapper.unmount();
  });
});

describe('LockRoomModal — reconnect ordering (no stale-sync clobber)', () => {
  it('reconnects the WS only AFTER the lock PATCH has landed', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);

    const order: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/auth/admin')) {
        order.push('auth');
        return { ok: true, json: async () => ({ token: ADMIN_TOKEN }) } as Response;
      }
      if (String(url).includes('/lock')) {
        order.push('lock');
        return { ok: true, json: async () => ({ ok: true, locked: true }) } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.spyOn(store, 'reconnect').mockImplementation(() => { order.push('reconnect'); });

    const wrapper = mount(LockRoomModal, { props: { modelValue: true } });
    const input = document.querySelector('[data-testid="lock-room-admin-password"]') as HTMLInputElement;
    input.value = 'admin-secret';
    input.dispatchEvent(new Event('input'));
    await nextTick();

    (document.querySelector('[data-testid="lock-room-submit"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
    await new Promise((r) => setTimeout(r, 0));

    expect(order).toEqual(['auth', 'lock', 'reconnect']);
    // Locked state must survive: the fresh sync after reconnect reads
    // post-UPDATE DB state, and locally we already applied the result.
    expect(store.locked).toBe(true);
    wrapper.unmount();
  });
});
