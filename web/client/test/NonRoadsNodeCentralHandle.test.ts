import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import NonRoadsNode from '../src/components/flow/NonRoadsNode.vue'
import { createTestingPinia } from '@pinia/testing'
import { ref } from 'vue'
import { useRoomStore } from '../src/stores/useRoomStore'

describe('NonRoadsNode Central Handle', () => {
  const mountNode = () => {
    return mount(NonRoadsNode as any, {
      props: {
        id: 'test-node',
        type: 'non-roads',
        data: {
          type: 'royalBlue',
          tier: 5,
          zoneName: 'Test Zone',
        },
        selected: false,
        dragging: false,
        resizing: false,
        connectable: true,
        zIndex: 0,
        position: { x: 0, y: 0 },
        dimensions: { width: 150, height: 150 },
        events: {} as any,
      },
      global: {
        plugins: [createTestingPinia({ createSpy: vi.fn })],
        provide: {
          globalNow: ref(Date.now()),
        },
        stubs: {
          Handle: {
            template: '<div class="handle-stub" :id="id"><slot /></div>',
            props: ['id']
          },
          ZoneHeader: true,
        }
      }
    })
  }

  it('renders exactly one central handle by default', () => {
    const wrapper = mountNode()
    const handles = wrapper.findAll('.handle-stub')
    // center + nw + ne + se + sw = 5 handles
    expect(handles.length).toBe(5)
    const ids = handles.map(h => h.attributes('id'))
    expect(ids).toContain('center')
  })

  it('renders central handle and overlay when isConnecting is true', async () => {
    const wrapper = mountNode()
    const store = useRoomStore()
    store.isConnecting = true
    await wrapper.vm.$nextTick()
    
    const handles = wrapper.findAll('.handle-stub')
    // center + nw + ne + se + sw + center-overlay = 6 handles
    expect(handles.length).toBe(6)
    const ids = handles.map(h => h.attributes('id'))
    expect(ids).toContain('center')
    expect(ids).toContain('center-overlay')
  })
})
