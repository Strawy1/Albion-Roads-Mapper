import { onMounted, onUnmounted, ref, type Ref } from 'vue';
import { API_BASE_URL } from '@/utils/api';

// How often to ask the API for the current client-version token.
const POLL_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Manual test override. Set `localStorage.setItem('show_reload', 'true')` and
 * reload: the prompt appears immediately without touching the API or the DB
 * token. It survives reloads by design, so you can exercise the Reload button
 * repeatedly — clear it with `localStorage.removeItem('show_reload')`.
 */
export const SHOW_RELOAD_FLAG = 'show_reload';

const testFlagSet = (): boolean => {
  try {
    return localStorage.getItem(SHOW_RELOAD_FLAG) === 'true';
  } catch {
    return false; // storage disabled (private mode) — behave normally
  }
};

export interface VersionWatch {
  /** True once the server's token has changed since this tab loaded. */
  updateAvailable: Ref<boolean>;
  /** Reload the page to pick up the new build. */
  reload: () => void;
}

/**
 * Watches the server's `client_version` token so a release can tell every open
 * tab — including users NOT inside a room, who hold no WebSocket — that a newer
 * build exists. On load we snapshot whatever the API returns; we then poll it
 * (and re-check whenever the tab becomes visible). If the value ever differs
 * from the snapshot we flip `updateAvailable` and stop polling; the UI prompts
 * the user to reload rather than reloading under them, so nobody loses work
 * mid-edit. Start a wave by bumping the DB value by hand, e.g.
 *   UPDATE app_settings SET value = value::int + 1 WHERE key = 'client_version';
 */
export function useVersionWatch(): VersionWatch {
  const updateAvailable = ref(false);
  let baseline: string | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  const stopPolling = (): void => {
    if (timer) clearInterval(timer);
    timer = undefined;
    document.removeEventListener('visibilitychange', onVisible);
  };

  const check = async (): Promise<void> => {
    let version: string;
    try {
      const res = await fetch(`${API_BASE_URL}/api/version`, { cache: 'no-store' });
      if (!res.ok) return;
      ({ version } = (await res.json()) as { version: string });
    } catch {
      return; // network blip — keep the current baseline and retry next tick
    }
    if (typeof version !== 'string') return;

    if (baseline === null) {
      baseline = version; // first successful fetch establishes the snapshot
      return;
    }
    if (version !== baseline) {
      // The prompt is already up and the answer can't change — further polling
      // would just be noise, so stand down until the user reloads.
      updateAvailable.value = true;
      stopPolling();
    }
  };

  function onVisible(): void {
    if (document.visibilityState === 'visible') void check();
  }

  onMounted(() => {
    if (testFlagSet()) {
      // Force the prompt up for manual testing; skip polling entirely so the
      // real token can never clear it back down.
      updateAvailable.value = true;
      return;
    }
    void check();
    timer = setInterval(() => void check(), POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
  });

  onUnmounted(stopPolling);

  return {
    updateAvailable,
    reload: () => window.location.reload(),
  };
}
