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
import { getTotalSocketCount } from './broadcast.js';

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
 * Returns the current UTC hour as an ISO-8601 timestamp truncated to the hour,
 * e.g. "2026-06-13T04:00:00.000Z". Used both as a change-detection key and as
 * the DB primary key value for analytics_hourly_connections.
 */
function utcHourTimestamp(): string {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  return now.toISOString();
}

/**
 * Upserts the current total WebSocket connection count into analytics_hourly_connections
 * for the current UTC hour bucket. Safe to call multiple times per hour — uses GREATEST
 * for max_connections and LEAST for min_connections so the stored values represent the
 * true peak and trough observed across all samples within that hour.
 */
export async function flushHourlyConnections(db: Pool): Promise<void> {
  const hour = utcHourTimestamp();
  const count = getTotalSocketCount();
  try {
    await db.query(
      `INSERT INTO analytics_hourly_connections (hour, max_connections, min_connections)
       VALUES ($1, $2, $2)
       ON CONFLICT (hour) DO UPDATE
         SET max_connections = GREATEST(analytics_hourly_connections.max_connections, EXCLUDED.max_connections),
             min_connections = LEAST(analytics_hourly_connections.min_connections, EXCLUDED.min_connections)`,
      [hour, count],
    );
  } catch (err) {
    console.error('[analyticsCron] failed to flush hourly connections:', err);
  }
}

/**
 * Starts the analytics cron.
 * - Every minute: flush in-memory concurrency/token data to the DB and record
 *   the current total WebSocket connection count into analytics_hourly_connections
 *   for the current UTC hour bucket (GREATEST ensures the peak is kept).
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

      // Every tick: record the current WS connection count for this hour bucket.
      // Calling this every minute (rather than once at the hour boundary) means
      // GREATEST accumulates the true peak across all 60 samples in the hour,
      // giving us correct per-day per-hour maximum concurrent connections.
      await flushHourlyConnections(db);
    })().catch((err) => console.error('[analyticsCron] tick error:', err));
  }, 60_000);
}
