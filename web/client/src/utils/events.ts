import { API_BASE_URL } from './api';

/**
 * Fire-and-forget analytics event (POST /api/events). Event types are open
 * slugs (lowercase/digits/underscores) — the server buckets them per day
 * without needing any changes for new types. Failures are swallowed:
 * analytics must never affect the UI.
 */
export function sendEvent(type: string): void {
  try {
    void fetch(`${API_BASE_URL}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    }).catch(() => { /* ignore */ });
  } catch { /* ignore */ }
}
