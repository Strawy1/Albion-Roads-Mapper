import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import RoomSettings from '../src/components/RoomSettings.vue';
import { useRoomStore } from '@/stores/useRoomStore';
import { useRoomMemoryStore } from '@/stores/useRoomMemoryStore';
import type { RoomMemoryEntry } from 'shared';
import { nextTick } from 'vue';

let attachTo: HTMLDivElement;

beforeEach(() => {
  setActivePinia(createPinia());
  attachTo = document.createElement('div');
  document.body.appendChild(attachTo);
});

afterEach(() => {
  document.body.removeChild(attachTo);
});

describe('RoomSettings', () => {
  it('closes when clicking outside', async () => {
    const wrapper = mount(RoomSettings, { attachTo });
    
    // Find the gear icon
    const cog = wrapper.find('[data-testid="settings-cog"]');
    await cog.trigger('click');
    
    // Check if popup is open
    expect(wrapper.find('[data-testid="settings-popup"]').exists()).toBe(true);

    // Click outside
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // Check if closed
    expect(wrapper.find('[data-testid="settings-popup"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it('clearRoom() deletes connections but does NOT clear the memory store', async () => {
    const store = useRoomStore();
    store.setCredentials('room123', 'test-token');
    const memoryStore = useRoomMemoryStore();
    memoryStore.applyMemorySync([{ zoneId: 'zone-abc', features: [], notes: '' } as unknown as RoomMemoryEntry]);
    expect(memoryStore.memory.size).toBe(1);

    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    const wrapper = mount(RoomSettings, { attachTo });
    await (wrapper.vm as any).clearRoom();
    await nextTick();

    expect(memoryStore.memory.size).toBe(1);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/rooms/room123/connections'),
      expect.objectContaining({ method: 'DELETE' }),
    );
    wrapper.unmount();
  });

  it('resetWithHistory() clears the memory store and calls both endpoints with adminPassword', async () => {
    const store = useRoomStore();
    store.setCredentials('room123', 'test-token');
    const memoryStore = useRoomMemoryStore();
    memoryStore.applyMemorySync([{ zoneId: 'zone-abc', features: [], notes: '' } as unknown as RoomMemoryEntry]);
    expect(memoryStore.memory.size).toBe(1);

    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    const wrapper = mount(RoomSettings, { attachTo });
    const setError = vi.fn();
    await (wrapper.vm as any).resetWithHistory('admin-secret', setError);
    await nextTick();

    expect(memoryStore.memory.size).toBe(0);
    expect(setError).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/rooms/room123/connections'),
      expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ adminPassword: 'admin-secret' }) }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/rooms/room123/memory'),
      expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ adminPassword: 'admin-secret' }) }),
    );
    wrapper.unmount();
  });

  it('does not close when clicking inside', async () => {
    const wrapper = mount(RoomSettings, { attachTo });
    
    // Find the gear icon
    const cog = wrapper.find('[data-testid="settings-cog"]');
    await cog.trigger('click');
    
    // Check if popup is open
    expect(wrapper.find('[data-testid="settings-popup"]').exists()).toBe(true);

    // Click inside (on the reset button)
    const resetBtn = wrapper.find('[data-testid="settings-reset-room"]');
    await resetBtn.trigger('click');
    
    // Check if still open
    expect(wrapper.find('[data-testid="settings-popup"]').exists()).toBe(true);

    wrapper.unmount();
  });
});
