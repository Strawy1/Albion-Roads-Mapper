/**
 * Per-connection dismissal state for the "Link Zone portals!" edge hint.
 *
 * Dismissing the hint used to be component-local, so it came back on every
 * reload/remount. Ids are keyed on the connection id (which is also the edge id)
 * and pruned against live connections so the list can't grow forever as
 * connections expire.
 */
const STORAGE_KEY = 'linkPortalsHintDismissedIds';

export function readDismissedLinkPortalsHints(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function isLinkPortalsHintDismissed(connectionId: string): boolean {
  return readDismissedLinkPortalsHints().has(connectionId);
}

export function dismissLinkPortalsHint(connectionId: string) {
  try {
    const ids = readDismissedLinkPortalsHints();
    if (ids.has(connectionId)) return;
    ids.add(connectionId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch { /* ignore */ }
}

/** Drop dismissals for connections that no longer exist. */
export function pruneDismissedLinkPortalsHints(liveIds: Iterable<string>) {
  try {
    const ids = readDismissedLinkPortalsHints();
    if (ids.size === 0) return;
    const live = new Set(liveIds);
    const kept = [...ids].filter(id => live.has(id));
    if (kept.length === ids.size) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch { /* ignore */ }
}
