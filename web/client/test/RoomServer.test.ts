import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { useRoomStore } from '@/stores/useRoomStore';
import RoomServerModal from '../src/components/RoomServerModal.vue';
import TitleSegment from '../src/components/room/TitleSegment.vue';

(global as any).WebSocket = class {
  static OPEN = 1;
  readyState = 0;
  send() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
};

/** Unsigned JWT — the store only decodes it for display purposes. */
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

// Modals teleport into <body>, so a wrapper left mounted would leak its DOM
// into the next test's querySelector lookups.
let mounted: ReturnType<typeof mount> | null = null;
function mountModal(props: Record<string, unknown>) {
  mounted = mount(RoomServerModal, { props: props as any, attachTo: document.body });
  return mounted;
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useRoomStore — room server', () => {
  it('sync applies the server, and leaves it null when the room has none', () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);

    store.applyMessage(minimalSync({ server: 'us' }));
    expect(store.roomServer).toBe('us');

    store.applyMessage(minimalSync());
    expect(store.roomServer).toBeNull();
  });

  it('room_server_updated applies live', () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);
    store.applyMessage(minimalSync({ server: 'eu' }));

    store.applyMessage({ type: 'room_server_updated', server: 'asia' } as any);
    expect(store.roomServer).toBe('asia');
  });

  it('needsServerAssignment stays false between auth_ok and the sync landing', () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);

    // auth_ok flips wsStatus before any sync arrives: roomServer is still null
    // here, and prompting on that flashes the modal on every load of an
    // already-assigned room.
    store.wsStatus = 'connected';
    expect(store.needsServerAssignment).toBe(false);

    store.applyMessage(minimalSync({ server: 'eu' }));
    expect(store.needsServerAssignment).toBe(false);
  });

  it('needsServerAssignment only fires for a connected, editable, unassigned room', () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);

    // Not connected yet — no prompt, even though the server is unknown.
    store.applyMessage(minimalSync());
    expect(store.needsServerAssignment).toBe(false);

    store.wsStatus = 'connected';
    expect(store.needsServerAssignment).toBe(true);

    // A locked room's read-only visitors must not be trapped behind a modal
    // whose save the server would reject.
    store.applyMessage(minimalSync({ locked: true }));
    expect(store.needsServerAssignment).toBe(false);

    // …but an admin session in the same locked room still gets asked.
    store.setCredentials(ROOM_ID, ADMIN_TOKEN);
    store.applyMessage(minimalSync({ locked: true }));
    expect(store.needsServerAssignment).toBe(true);

    // Assigned rooms never prompt.
    store.applyMessage(minimalSync({ server: 'eu' }));
    expect(store.needsServerAssignment).toBe(false);
  });

  it('setRoomServer omits adminPassword when none is supplied and stores the result', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, server: 'eu' }) });
    vi.stubGlobal('fetch', fetchMock);

    const res = await store.setRoomServer('eu');

    expect(res.ok).toBe(true);
    expect(store.roomServer).toBe('eu');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(`/api/rooms/${ROOM_ID}/server`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ server: 'eu' });
  });

  it('setRoomServer refuses to fire in a locked read-only room', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);
    store.applyMessage(minimalSync({ locked: true }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await store.setRoomServer('eu');

    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('TitleSegment — server pill', () => {
  function mountTitle(roomTitle: string) {
    mounted = mount(TitleSegment, {
      props: { roomTitle },
      global: { stubs: { RoomSettings: true } },
      attachTo: document.body,
    });
    return mounted;
  }

  it('nests the server pill inside the title pill and opens the change modal without renaming', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);
    store.applyMessage(minimalSync({ title: 'Dragon Den', server: 'us' }));

    const wrapper = mountTitle('Dragon Den');
    await nextTick();

    const titlePill = wrapper.get('[data-testid="rename-room-button"]');
    const pill = titlePill.get('[data-testid="room-server-pill"]');
    expect(pill.text()).toBe('Americas');

    await pill.trigger('click');
    await nextTick();

    expect(document.querySelector('[data-testid="room-server-modal"]')).not.toBeNull();
    // The click must not bubble to the surrounding rename target.
    expect(document.body.textContent).not.toContain('Rename Room');
  });

  it('renders a non-interactive pill for read-only sessions', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);
    store.applyMessage(minimalSync({ title: 'Dragon Den', server: 'eu', locked: true }));

    const wrapper = mountTitle('Dragon Den');
    await nextTick();

    const pill = wrapper.get('[data-testid="room-server-pill"]');
    expect(pill.element.tagName).toBe('SPAN');

    await pill.trigger('click');
    await nextTick();
    expect(document.querySelector('[data-testid="room-server-modal"]')).toBeNull();
  });

  it('shows no pill while the room is unassigned', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);
    store.applyMessage(minimalSync({ title: 'Dragon Den' }));

    const wrapper = mountTitle('Dragon Den');
    await nextTick();

    expect(wrapper.find('[data-testid="room-server-pill"]').exists()).toBe(false);
  });
});

describe('RoomServerModal', () => {
  it('blocking mode has no cancel button and ignores backdrop clicks', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);
    store.applyMessage(minimalSync());

    const wrapper = mountModal({ modelValue: true, blocking: true });
    await nextTick();

    const buttons = document.querySelectorAll('[data-testid="room-server-modal"] button');
    expect([...buttons].some(b => b.textContent?.trim() === 'Cancel')).toBe(false);

    (document.querySelector('[data-testid="room-server-modal"]') as HTMLElement).click();
    await nextTick();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('saves a first assignment without asking for the admin password', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);
    store.applyMessage(minimalSync());
    const setRoomServer = vi.spyOn(store, 'setRoomServer').mockResolvedValue({ ok: true });

    mountModal({ modelValue: true, blocking: true });
    await nextTick();

    expect(document.querySelector('[data-testid="room-server-admin-password"]')).toBeNull();

    (document.querySelector('[data-testid="server-option-asia"]') as HTMLElement).click();
    await nextTick();
    expect(document.querySelector('[data-testid="room-server-admin-password"]')).toBeNull();

    (document.querySelector('[data-testid="room-server-save"]') as HTMLElement).click();
    await nextTick();

    expect(setRoomServer).toHaveBeenCalledWith('asia', undefined);
  });

  it('requires the admin password when changing an already-assigned server', async () => {
    const store = useRoomStore();
    store.setCredentials(ROOM_ID, REGULAR_TOKEN);
    store.applyMessage(minimalSync({ server: 'eu' }));
    const setRoomServer = vi.spyOn(store, 'setRoomServer').mockResolvedValue({ ok: true });

    mountModal({ modelValue: true });
    await nextTick();

    (document.querySelector('[data-testid="server-option-us"]') as HTMLElement).click();
    await nextTick();

    const pwInput = document.querySelector('[data-testid="room-server-admin-password"]') as HTMLInputElement;
    expect(pwInput).not.toBeNull();

    // Empty admin password → refused client-side, no request.
    (document.querySelector('[data-testid="room-server-save"]') as HTMLElement).click();
    await nextTick();
    expect(setRoomServer).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="room-server-error"]')?.textContent).toContain('Admin password');

    pwInput.value = 'admin-pw';
    pwInput.dispatchEvent(new Event('input'));
    await nextTick();
    (document.querySelector('[data-testid="room-server-save"]') as HTMLElement).click();
    await nextTick();

    expect(setRoomServer).toHaveBeenCalledWith('us', 'admin-pw');
  });
});
