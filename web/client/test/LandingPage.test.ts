import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import CreateRoomView from '../src/views/CreateRoomView.vue';

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  useRoute: () => ({
    query: {},
  }),
}));

describe('LandingPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('has a character limit of 50 on the room title input', async () => {
    const wrapper = mount(CreateRoomView, {
      global: {
        stubs: ['ZoneCombobox']
      }
    });

    const titleInput = wrapper.find('input[placeholder="e.g. My Guild Room"]');
    expect(titleInput.exists()).toBe(true);
    expect(titleInput.attributes('maxlength')).toBe('50');
  });
});
