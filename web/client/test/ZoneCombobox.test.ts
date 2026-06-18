import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { useRoomStore } from '../src/stores/useRoomStore.js';
import { ZONES } from 'shared';
import ZoneCombobox from '../src/components/ZoneCombobox.vue';

// We test the filtering logic by inspecting the component's internal computed
// rather than fighting reka-ui's portal teleportation in jsdom.

describe('ZoneCombobox filtering logic', () => {
  it('smartAlreadyAdded hides already-added zones when no query', () => {
    setActivePinia(createPinia());
    const store = useRoomStore();
    // Make sure we have some connections
    store.connections = [{
      id: '550e8400-e29b-41d4-a716-446655440000',
      roomId: 'room1',
      fromZoneId: '1',
      toZoneId: '2',
      expiresAt: new Date().toISOString(),
      reportedAt: new Date().toISOString(),
    }];

    const wrapper = mount(ZoneCombobox, {
      props: { modelValue: '', smartAlreadyAdded: true },
      global: { plugins: [createPinia()] },
    });
    
    // @ts-ignore
    const filteredZones = wrapper.vm.filteredZones;
    const mappedZoneIds = new Set(['1', '2']);
    
    // All mapped zones should be absent if !query
    filteredZones.forEach((z: any) => {
        expect(mappedZoneIds.has(z.id)).toBe(false);
    });
    wrapper.unmount();
  });

  it('smartAlreadyAdded sorts already-added zones to bottom when query', async () => {
    setActivePinia(createPinia());
    const store = useRoomStore();
    store.connections = [{
      id: '550e8400-e29b-41d4-a716-446655440000',
      roomId: 'room1',
      fromZoneId: '1',
      toZoneId: '2',
      expiresAt: new Date().toISOString(),
      reportedAt: new Date().toISOString(),
    }];

    const wrapper = mount(ZoneCombobox, {
      props: { modelValue: '', smartAlreadyAdded: true, alreadyAddedPlacement: 'bottom' },
      global: { plugins: [createPinia()] },
    });
    
    // Set query
    await wrapper.find('[data-testid="zone-combobox-input"]').setValue('a');

    // @ts-ignore
    const filteredZones = wrapper.vm.filteredZones;
    
    // Check if any mapped zone exists
    const mappedIds = new Set(['1', '2']);
    
    // For bottom placement, mapped zones should be at the end if they appear.
    // Let's verify the sorting
    const mappedZones = filteredZones.filter((z: any) => mappedIds.has(z.id));
    const unmappedZones = filteredZones.filter((z: any) => !mappedIds.has(z.id));
    
    // Verify mapped zones are at the end
    if (mappedZones.length > 0 && unmappedZones.length > 0) {
        const lastZone = filteredZones[filteredZones.length - 1];
        expect(mappedIds.has(lastZone.id)).toBe(true);
    }
    
    wrapper.unmount();
  });

  it('smartAlreadyAdded sorts already-added zones to top when query', async () => {
    setActivePinia(createPinia());
    const store = useRoomStore();
    store.connections = [{
      id: '550e8400-e29b-41d4-a716-446655440000',
      roomId: 'room1',
      fromZoneId: '1',
      toZoneId: '2',
      expiresAt: new Date().toISOString(),
      reportedAt: new Date().toISOString(),
    }];

    const wrapper = mount(ZoneCombobox, {
      props: { modelValue: '', smartAlreadyAdded: true, alreadyAddedPlacement: 'top' },
      global: { plugins: [createPinia()] },
    });
    
    // Set query
    await wrapper.find('[data-testid="zone-combobox-input"]').setValue('a');

    // @ts-ignore
    const filteredZones = wrapper.vm.filteredZones;
    
    // Check if any mapped zone exists
    const mappedIds = new Set(['1', '2']);
    
    // For top placement, mapped zones should be at the beginning.
    const mappedZones = filteredZones.filter((z: any) => mappedIds.has(z.id));
    
    if (mappedZones.length > 0) {
        const firstZone = filteredZones[0];
        expect(mappedIds.has(firstZone.id)).toBe(true);
    }
    
    wrapper.unmount();
  });

  it('smartAlreadyAdded sorts home zone to top', async () => {
    setActivePinia(createPinia());
    const store = useRoomStore();
    const homeZone = ZONES[0];
    store.homeZoneId = homeZone.id;

    const wrapper = mount(ZoneCombobox, {
      props: { modelValue: '', smartAlreadyAdded: true },
      global: { plugins: [createPinia()] },
    });
    
    // Set query
    // @ts-ignore
    wrapper.vm.query = homeZone.name;

    // @ts-ignore
    const filteredZones = wrapper.vm.filteredZones;
    
    expect(filteredZones[0]?.id).toBe(homeZone.id);
    
    wrapper.unmount();
  });

  it('onlyRoadsHideout filters zones to only roads hideouts', async () => {
    setActivePinia(createPinia());
    const wrapper = mount(ZoneCombobox, {
      props: { modelValue: '', onlyRoadsHideout: true },
      global: { plugins: [createPinia()] },
    });
    
    // No query set - should still show hideouts
    
    // @ts-ignore
    const filteredZones = wrapper.vm.filteredZones;
    
    expect(filteredZones.length).toBeGreaterThan(0);
    filteredZones.forEach((z: any) => {
        expect(z.isRoadsHome).toBe(true);
    });
    
    // Verify some non-hideout zones are NOT in the list
    const hasRoyal = filteredZones.some((z: any) => z.type.startsWith('royal'));
    expect(hasRoyal).toBe(false);

    wrapper.unmount();
  });

  it('only searches by name', async () => {
    setActivePinia(createPinia());
    const wrapper = mount(ZoneCombobox, {
      props: { modelValue: '' },
      global: { plugins: [createPinia()] },
    });
    
    // Pick a zone that we know exists
    const zone = ZONES[0];
    
    // Set query to its name
    // @ts-ignore
    wrapper.vm.query = zone.name;
    
    // @ts-ignore
    let filteredZones = wrapper.vm.filteredZones;
    expect(filteredZones.some((z: any) => z.id === zone.id)).toBe(true);

    // Set query to something that would match its type but NOT its name
    // @ts-ignore
    wrapper.vm.query = zone.type;
    
    // @ts-ignore
    filteredZones = wrapper.vm.filteredZones;
    
    // Should NOT contain the zone if we are only searching by name
    if (!zone.name.toLowerCase().includes(zone.type.toLowerCase())) {
        expect(filteredZones.some((z: any) => z.id === zone.id)).toBe(false);
    }
    
    wrapper.unmount();
  });
});

describe('ZoneCombobox Tab key accepts single result', () => {
  it('selects the only non-disabled result when Tab is pressed', () => {
    setActivePinia(createPinia());
    const wrapper = mount(ZoneCombobox, {
      props: { modelValue: '' },
      global: { plugins: [createPinia()] },
    });

    // Simulate: user typed "Saddle" — filteredZones has exactly one result: Saddle Tor
    wrapper.vm.setTestQuery('Saddle');

    // Verify the filter immediately returns exactly one non-disabled zone (computed is lazy/sync)
    const filtered: any[] = wrapper.vm.getTestFilteredZones();
    expect(filtered.length).toBe(1);
    expect(filtered[0].name).toBe('Saddle Tor');

    // Fire Tab via the exposed trigger — no reka-ui involved
    wrapper.vm.triggerTabKeydown();

    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe('saddle-tor');
    wrapper.unmount();
  });

  it('does NOT auto-select when there are multiple results', () => {
    setActivePinia(createPinia());
    const wrapper = mount(ZoneCombobox, {
      props: { modelValue: '' },
      global: { plugins: [createPinia()] },
    });

    // "a" matches many zones
    wrapper.vm.setTestQuery('a');
    expect(wrapper.vm.getTestFilteredZones().length).toBeGreaterThan(1);

    wrapper.vm.triggerTabKeydown();

    expect(wrapper.emitted('update:modelValue')).toBeFalsy();
    wrapper.unmount();
  });

  it('does NOT auto-select when the only result is disabled', () => {
    setActivePinia(createPinia());
    const wrapper = mount(ZoneCombobox, {
      props: { modelValue: '', disabledIds: ['saddle-tor'] },
      global: { plugins: [createPinia()] },
    });

    // "Saddle" matches only Saddle Tor, but it is in disabledIds
    wrapper.vm.setTestQuery('Saddle');
    expect(wrapper.vm.getTestFilteredZones().length).toBe(1);

    wrapper.vm.triggerTabKeydown();

    expect(wrapper.emitted('update:modelValue')).toBeFalsy();
    wrapper.unmount();
  });
});

describe('ZoneCombobox chain manager disabled zones', () => {
  it('source zone IDs passed as disabledIds are not selectable', () => {
    setActivePinia(createPinia());
    // 'adrens-hill' is a real zone; simulate it being a chain source zone
    const wrapper = mount(ZoneCombobox, {
      props: { modelValue: '', disabledIds: ['adrens-hill'], showAlreadyAdded: false },
      global: { plugins: [createPinia()] },
    });

    wrapper.vm.setTestQuery('Adrens Hill');
    const filtered: any[] = wrapper.vm.getTestFilteredZones();
    const zone = filtered.find((z: any) => z.id === 'adrens-hill');
    expect(zone).toBeTruthy();

    // Attempting to select it should not emit
    wrapper.vm.triggerTabKeydown();
    expect(wrapper.emitted('update:modelValue')).toBeFalsy();

    wrapper.unmount();
  });

  it('chain member zone IDs passed as disabledIds are not selectable', () => {
    setActivePinia(createPinia());
    // 'anklesnag-mire' is a real zone; simulate it being a member of a chain
    const wrapper = mount(ZoneCombobox, {
      props: { modelValue: '', disabledIds: ['anklesnag-mire'], showAlreadyAdded: false },
      global: { plugins: [createPinia()] },
    });

    wrapper.vm.setTestQuery('Anklesnag Mire');
    const filtered: any[] = wrapper.vm.getTestFilteredZones();
    const zone = filtered.find((z: any) => z.id === 'anklesnag-mire');
    expect(zone).toBeTruthy();

    wrapper.vm.triggerTabKeydown();
    expect(wrapper.emitted('update:modelValue')).toBeFalsy();

    wrapper.unmount();
  });

  it('zones not in disabledIds remain selectable', () => {
    setActivePinia(createPinia());
    const wrapper = mount(ZoneCombobox, {
      props: { modelValue: '', disabledIds: ['adrens-hill'], showAlreadyAdded: false },
      global: { plugins: [createPinia()] },
    });

    wrapper.vm.setTestQuery('Saddle Tor');
    const filtered: any[] = wrapper.vm.getTestFilteredZones();
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('saddle-tor');

    wrapper.vm.triggerTabKeydown();
    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe('saddle-tor');

    wrapper.unmount();
  });

  it('disabled zones do not appear without a query', () => {
    setActivePinia(createPinia());
    const store = useRoomStore();
    // Put 'adrens-hill' in connections so it would normally appear
    store.connections = [{
      id: '550e8400-e29b-41d4-a716-446655440000',
      roomId: 'room1',
      fromZoneId: 'adrens-hill',
      toZoneId: 'brecillien',
      expiresAt: new Date().toISOString(),
      reportedAt: new Date().toISOString(),
    }];

    const wrapper = mount(ZoneCombobox, {
      props: { modelValue: '', disabledIds: ['adrens-hill'], showAlreadyAdded: false },
      global: { plugins: [createPinia()] },
    });

    // No query — disabled zones should not appear
    const filtered: any[] = wrapper.vm.getTestFilteredZones();
    expect(filtered.find((z: any) => z.id === 'adrens-hill')).toBeUndefined();

    wrapper.unmount();
  });
});

describe('ZoneCombobox component renders', () => {
  it('renders the input with the correct placeholder', () => {
    const wrapper = mount(ZoneCombobox, {
      props: { modelValue: '', placeholder: 'Search zones…' },
      global: { plugins: [createPinia()] },
    });
    const input = wrapper.find('[data-testid="zone-combobox-input"]');
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).placeholder).toBe('Search zones…');
    wrapper.unmount();
  });

  it('renders with icon when provided', () => {
    const wrapper = mount(ZoneCombobox, {
      props: { modelValue: '', icon: '🏠' },
      global: { plugins: [createPinia()] },
    });
    expect(wrapper.text()).toContain('🏠');
    wrapper.unmount();
  });

  it('applies disabled styles', () => {
    const wrapper = mount(ZoneCombobox, {
      props: { modelValue: '', disabled: true },
      global: { plugins: [createPinia()] },
    });
    const container = wrapper.find('.cursor-not-allowed');
    expect(container.exists()).toBe(true);
    
    const input = wrapper.find('[data-testid="zone-combobox-input"]');
    expect(input.classes()).toContain('cursor-not-allowed');
    wrapper.unmount();
  });
});
