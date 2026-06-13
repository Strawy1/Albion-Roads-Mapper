import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach } from 'vitest';
import { useRoomStore } from '../../src/stores/useRoomStore';

describe('exitRoom token persistence', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('preserves the token in localStorage after exitRoom', () => {
    const store = useRoomStore();
    localStorage.setItem('token:room-1', 'my-token-abc');
    store.setCredentials('room-1', 'my-token-abc');

    store.exitRoom();

    expect(localStorage.getItem('token:room-1')).toBe('my-token-abc');
  });

  it('keeps separate tokens for two different rooms after exiting each', () => {
    const store = useRoomStore();

    // Enter room-1
    localStorage.setItem('token:room-1', 'token-for-room-1');
    store.setCredentials('room-1', 'token-for-room-1');
    store.exitRoom();

    // Enter room-2
    localStorage.setItem('token:room-2', 'token-for-room-2');
    store.setCredentials('room-2', 'token-for-room-2');
    store.exitRoom();

    expect(localStorage.getItem('token:room-1')).toBe('token-for-room-1');
    expect(localStorage.getItem('token:room-2')).toBe('token-for-room-2');
  });
});
