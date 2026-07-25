import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import {
  useVersionWatch,
  SHOW_RELOAD_FLAG,
  type VersionWatch,
} from '../src/composables/useVersionWatch';

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://localhost',
}));

const POLL_INTERVAL_MS = 3 * 60 * 1000;

// Minimal host component — the composable relies on onMounted/onUnmounted so it
// has to run inside a component instance. `watch` exposes the returned state.
let watcher: VersionWatch;
const Host = defineComponent({
  setup() {
    watcher = useVersionWatch();
    return () => h('div');
  },
});

const updateAvailable = () => watcher.updateAvailable.value;

let wrappers: VueWrapper[] = [];

// test/setup.ts only auto-cleans @testing-library mounts, so track our own —
// a leaked instance keeps its interval and visibilitychange listener alive and
// would fire extra fetches during later tests.
const mountHost = (): VueWrapper => {
  const wrapper = mount(Host);
  wrappers.push(wrapper);
  return wrapper;
};

/** Queue a `{ version }` response for the next fetch call. */
const respondWith = (version: unknown, ok = true) => {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok,
    json: () => Promise.resolve({ version }),
  } as unknown as Response);
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  global.fetch = vi.fn();
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount();
  wrappers = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useVersionWatch', () => {
  it('snapshots the version on mount without prompting', async () => {
    respondWith('1');

    mountHost();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('http://localhost/api/version', { cache: 'no-store' });
    // The first value is the baseline — it must never prompt, otherwise every
    // page load would immediately ask the user to reload.
    expect(updateAvailable()).toBe(false);
  });

  it('does not prompt while the version is unchanged', async () => {
    respondWith('1');
    mountHost();
    await flushPromises();

    respondWith('1');
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(updateAvailable()).toBe(false);
  });

  it('flags an update when the version token changes', async () => {
    respondWith('1');
    mountHost();
    await flushPromises();

    respondWith('2');
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(updateAvailable()).toBe(true);
  });

  it('never reloads on its own — only via the returned reload()', async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
      configurable: true,
    });

    respondWith('1');
    mountHost();
    await flushPromises();

    respondWith('2');
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    // The whole point of the prompt: detecting a new build must not interrupt
    // whatever the user is doing.
    expect(updateAvailable()).toBe(true);
    expect(reloadSpy).not.toHaveBeenCalled();

    watcher.reload();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('stops polling once an update has been flagged', async () => {
    respondWith('1');
    mountHost();
    await flushPromises();

    respondWith('2');
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Nothing left to learn — the prompt is up until the user acts.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(updateAvailable()).toBe(true);
  });

  it('re-checks when the tab becomes visible', async () => {
    respondWith('1');
    mountHost();
    await flushPromises();

    respondWith('2');
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();

    // Focus-driven check reaches backgrounded tabs whose interval was throttled.
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(updateAvailable()).toBe(true);
  });

  it('ignores visibilitychange when the tab is hidden', async () => {
    respondWith('1');
    mountHost();
    await flushPromises();

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('survives a network error and keeps polling', async () => {
    respondWith('1');
    mountHost();
    await flushPromises();

    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(updateAvailable()).toBe(false);

    // Baseline must survive the blip, so a later unchanged value still doesn't prompt.
    respondWith('1');
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(updateAvailable()).toBe(false);

    respondWith('2');
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(updateAvailable()).toBe(true);
  });

  it('ignores a non-ok response', async () => {
    respondWith('1');
    mountHost();
    await flushPromises();

    respondWith('2', false);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    // A 500 (e.g. the settings row missing) must not be read as a version change.
    expect(updateAvailable()).toBe(false);
  });

  it('ignores a malformed payload', async () => {
    respondWith('1');
    mountHost();
    await flushPromises();

    respondWith(undefined);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(updateAvailable()).toBe(false);
  });

  it('establishes the baseline from the first successful fetch, not the first attempt', async () => {
    // Offline at page load: no baseline yet. The first value we actually see
    // becomes the baseline, so it must not be treated as a change.
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    mountHost();
    await flushPromises();

    respondWith('9');
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(updateAvailable()).toBe(false);

    respondWith('10');
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(updateAvailable()).toBe(true);
  });

  describe('show_reload test flag', () => {
    it('shows the prompt immediately without hitting the API', async () => {
      localStorage.setItem(SHOW_RELOAD_FLAG, 'true');

      mountHost();
      await flushPromises();

      expect(updateAvailable()).toBe(true);
      // No API call at all — the flag is for testing the UI without touching
      // the DB token.
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('keeps the prompt up and never polls it away', async () => {
      localStorage.setItem(SHOW_RELOAD_FLAG, 'true');

      mountHost();
      await flushPromises();
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
      document.dispatchEvent(new Event('visibilitychange'));
      await flushPromises();

      expect(updateAvailable()).toBe(true);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('is ignored when unset or set to anything other than "true"', async () => {
      localStorage.setItem(SHOW_RELOAD_FLAG, 'false');
      respondWith('1');

      mountHost();
      await flushPromises();

      expect(updateAvailable()).toBe(false);
      expect(global.fetch).toHaveBeenCalledTimes(1); // normal polling resumed
    });

    it('falls back to normal behaviour when localStorage throws', async () => {
      // Spy on the localStorage object itself — test/setup.ts swaps in a plain
      // object, so Storage.prototype is never consulted.
      const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new Error('storage disabled');
      });
      respondWith('1');

      mountHost();
      await flushPromises();

      expect(updateAvailable()).toBe(false);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      getItem.mockRestore();
    });
  });

  it('stops polling and unhooks the listener after unmount', async () => {
    respondWith('1');
    const wrapper = mountHost();
    await flushPromises();

    wrapper.unmount();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
