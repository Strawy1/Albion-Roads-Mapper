import type { Pool } from 'pg';
import {
  utcDateString,
  flushConcurrencyStats,
  flushGlobalConcurrencyStats,
  recalculateRoomCounts,
} from './analytics.js';
import {
  getAnalyticsSnapshot,
  getGlobalAnalyticsSnapshot,
  clearAnalyticsDate,
} from './broadcast_analytics.js';

/**
 * Flushes all in-memory concurrency/token analytics to the DB.
 * Called on every cron tick and once more at midnight after the day rolls over.
 */
export async function runAnalyticsFlush(db: Pool): Promise<void> {
  const snapshot = getAnalyticsSnapshot();
  const dates = new Set(snapshot.map((s) => s.date));

  for (const { roomId, date, peakConcurrent, uniqueTokens } of snapshot) {
    if (peakConcurrent > 0 || uniqueTokens > 0) {
      await flushConcurrencyStats(db, roomId, date, peakConcurrent, uniqueTokens);
    }
  }

  for (const date of dates) {
    const { peakConcurrent, uniqueTokensActive } = getGlobalAnalyticsSnapshot(date);
    if (peakConcurrent > 0 || uniqueTokensActive > 0) {
      await flushGlobalConcurrencyStats(db, date, peakConcurrent, uniqueTokensActive);
    }
  }
}

/**
 * Starts the analytics cron.
 * - Every minute: flush in-memory concurrency/token data to the DB.
 * - On UTC date change: create the new day's global_daily row seeded with total_rooms,
 *   flush and clear the previous day's in-memory data.
 *
 * Returns the interval handle so it can be cleared on server shutdown.
 */
export function startAnalyticsCron(db: Pool): NodeJS.Timeout {
  let lastDate = utcDateString();

  return setInterval(() => {
    void (async () => {
      const today = utcDateString();

      if (today !== lastDate) {
        // Day has rolled over — do a final flush of the previous day then clear it
        await runAnalyticsFlush(db);
        clearAnalyticsDate(lastDate);
        lastDate = today;

        // Seed the new day's global row with a total_rooms snapshot
        try {
          await db.query(
            `INSERT INTO analytics_global_daily (date, total_rooms)
             VALUES ($1, (SELECT COUNT(*) FROM rooms))
             ON CONFLICT (date) DO NOTHING`,
            [today],
          );
          // Recalculate active/inactive based on any already-present room daily rows for today
          recalculateRoomCounts(db, today);
        } catch (err) {
          console.error('[analyticsCron] failed to seed new day row:', err);
        }
      } else {
        // Regular minute tick — flush current in-memory state
        await runAnalyticsFlush(db);
      }
    })().catch((err) => console.error('[analyticsCron] tick error:', err));
  }, 60_000);
}
