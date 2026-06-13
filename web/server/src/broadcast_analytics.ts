import { utcDateString } from './analytics.js';

// In-memory analytics state — flushed to DB each minute by analyticsCron
// roomId → date → Set of token fingerprints
const roomDailyTokens = new Map<string, Map<string, Set<string>>>();
// date → Set of token fingerprints across all rooms
const globalDailyTokens = new Map<string, Set<string>>();
// roomId → date → peak concurrent socket count
const roomDailyPeak = new Map<string, Map<string, number>>();
// date → global peak concurrent socket count
const globalDailyPeak = new Map<string, number>();

/** Derives a short, non-reversible fingerprint from a raw JWT string. */
function tokenFingerprint(token: string): string {
  const sig = token.split('.')[2] ?? token;
  return sig.slice(-32);
}

/**
 * Records a new socket connection for analytics purposes.
 * Tracks token fingerprint (for unique_tokens) and updates per-room and global peak concurrency.
 */
export function recordSocketAnalytics(
  roomId: string,
  token: string | undefined,
  roomCount: number,
  totalCount: number,
): void {
  const today = utcDateString();

  if (token) {
    const fp = tokenFingerprint(token);

    if (!roomDailyTokens.has(roomId)) roomDailyTokens.set(roomId, new Map());
    const roomDates = roomDailyTokens.get(roomId)!;
    if (!roomDates.has(today)) roomDates.set(today, new Set());
    roomDates.get(today)!.add(fp);

    if (!globalDailyTokens.has(today)) globalDailyTokens.set(today, new Set());
    globalDailyTokens.get(today)!.add(fp);
  }

  // Update per-room peak
  if (!roomDailyPeak.has(roomId)) roomDailyPeak.set(roomId, new Map());
  const roomPeaks = roomDailyPeak.get(roomId)!;
  roomPeaks.set(today, Math.max(roomPeaks.get(today) ?? 0, roomCount));

  // Update global peak
  globalDailyPeak.set(today, Math.max(globalDailyPeak.get(today) ?? 0, totalCount));
}

/**
 * Returns a snapshot of the current in-memory analytics state for the cron flush.
 * Each entry is: { roomId, date, peakConcurrent, uniqueTokens }
 */
export function getAnalyticsSnapshot(): Array<{ roomId: string; date: string; peakConcurrent: number; uniqueTokens: number }> {
  const result: Array<{ roomId: string; date: string; peakConcurrent: number; uniqueTokens: number }> = [];
  const allRoomIds = new Set([...roomDailyTokens.keys(), ...roomDailyPeak.keys()]);
  for (const roomId of allRoomIds) {
    const tokenDates = roomDailyTokens.get(roomId);
    const peakDates = roomDailyPeak.get(roomId);
    const allDates = new Set([...(tokenDates?.keys() ?? []), ...(peakDates?.keys() ?? [])]);
    for (const date of allDates) {
      result.push({
        roomId,
        date,
        peakConcurrent: peakDates?.get(date) ?? 0,
        uniqueTokens: tokenDates?.get(date)?.size ?? 0,
      });
    }
  }
  return result;
}

/**
 * Returns global peak and unique token count for a given date.
 */
export function getGlobalAnalyticsSnapshot(date: string): { peakConcurrent: number; uniqueTokensActive: number } {
  return {
    peakConcurrent: globalDailyPeak.get(date) ?? 0,
    uniqueTokensActive: globalDailyTokens.get(date)?.size ?? 0,
  };
}

/**
 * Clears in-memory analytics data for a specific date (called after cron flush of that date).
 */
export function clearAnalyticsDate(date: string): void {
  for (const [roomId, dates] of roomDailyTokens) {
    dates.delete(date);
    if (dates.size === 0) roomDailyTokens.delete(roomId);
  }
  for (const [roomId, dates] of roomDailyPeak) {
    dates.delete(date);
    if (dates.size === 0) roomDailyPeak.delete(roomId);
  }
  globalDailyTokens.delete(date);
  globalDailyPeak.delete(date);
}
