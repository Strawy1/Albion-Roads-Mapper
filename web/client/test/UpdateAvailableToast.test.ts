import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import UpdateAvailableToast from '../src/components/UpdateAvailableToast.vue';

describe('UpdateAvailableToast', () => {
  it('renders nothing until an update is available', () => {
    const wrapper = mount(UpdateAvailableToast, { props: { show: false } });

    expect(wrapper.text()).toBe('');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('shows the release message and a reload button when shown', () => {
    const wrapper = mount(UpdateAvailableToast, { props: { show: true } });

    expect(wrapper.text()).toContain('A new version has been released, please reload');
    expect(wrapper.find('button').text()).toBe('Reload');
  });

  it('emits reload when the button is clicked', async () => {
    const wrapper = mount(UpdateAvailableToast, { props: { show: true } });

    await wrapper.find('button').trigger('click');

    expect(wrapper.emitted('reload')).toHaveLength(1);
  });

  it('does not auto-dismiss — it stays up until the user acts', async () => {
    const wrapper = mount(UpdateAvailableToast, { props: { show: true } });

    // Clicking Reload only emits; the parent owns the decision to navigate, so
    // the prompt must not hide itself on click.
    await wrapper.find('button').trigger('click');

    expect(wrapper.text()).toContain('A new version has been released');
  });

  it('lets clicks through except on the prompt itself', () => {
    const wrapper = mount(UpdateAvailableToast, { props: { show: true } });

    // The full-width wrapper overlays the map, so it must be click-through
    // while the pill itself stays interactive.
    const overlay = wrapper.get('div');
    expect(overlay.classes()).toContain('pointer-events-none');
    expect(overlay.get('div').classes()).toContain('pointer-events-auto');
  });
});
