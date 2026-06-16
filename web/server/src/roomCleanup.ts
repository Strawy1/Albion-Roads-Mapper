import type { Pool } from 'pg';
import { incrementGlobal, incrementGlobalAlltime } from './analytics.js';

const ABORTED_GRACE_MS  = 48 * 60 * 60 * 1000; // 48 hours
const ABANDONED_GRACE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

interface RoomRow {
  id: string;
}

/**
 * Deletes rooms that were created but never really used, and rooms that were
 * modified but then abandoned. Increments analytics counters for each case.
 *
 * Aborted  — room has no zones beyond the home zone AND no map history AND no
 *             connections ever recorded, and the reference timestamp
 *             (updated_at if present, otherwise created_at) is older than 48 h.
 *
 * Abandoned — room has at least one non-home zone or some map history (i.e. the
 *             user did meaningful work), but has not been updated for 5 days
 *             (measured by updated_at, falling back to created_at).
 *
 * Safe to call frequently — uses a single cron tick minute interval.
 * Fire-and-forget callers should .catch() the returned promise.
 */
export async function runRoomCleanup(db: Pool): Promise<void> {
  const now = new Date();
  console.log('[roomCleanup] Starting cleanup at', now);

  // --- Aborted rooms ---
  // No zones beyond the home zone, no map history, reference time > 48 h ago.
  const abortedCutoff = new Date(now.getTime() - ABORTED_GRACE_MS).toISOString();
  const { rows: abortedRooms } = await db.query<RoomRow>(
    `SELECT r.id
     FROM rooms r
     WHERE
       -- No non-home zones on the map
       NOT EXISTS (
         SELECT 1 FROM room_node_positions rnp
         WHERE rnp.room_id = r.id AND rnp.zone_id != r.home_zone_id
       )
       -- No map history entries beyond the home zone
       AND NOT EXISTS (
         SELECT 1 FROM room_node_memory rnm
         WHERE rnm.room_id = r.id AND rnm.zone_id != r.home_zone_id
       )
       -- No connections ever added
       AND NOT EXISTS (
         SELECT 1 FROM connections c
         WHERE c.room_id = r.id
       )
       -- Reference timestamp older than 48 h (prefer updated_at, fall back to created_at)
       AND COALESCE(r.updated_at, r.created_at) < $1`,
    [abortedCutoff],
  );

  if (abortedRooms.length > 0) {
    const abortedIds = abortedRooms.map((r) => r.id);
    const placeholders = abortedIds.map((_, i) => `$${i + 1}`).join(', ');
    await db.query(`DELETE FROM rooms WHERE id IN (${placeholders})`, abortedIds);
    console.log(`[roomCleanup] deleted ${abortedIds.length} aborted room(s)`);

    incrementGlobal(db, { rooms_aborted: abortedIds.length });
    incrementGlobalAlltime(db, { rooms_aborted: abortedIds.length });
  }

  // --- Abandoned rooms ---
  // Has meaningful content (non-home zone or history), but last touched > 5 days ago.
  const abandonedCutoff = new Date(now.getTime() - ABANDONED_GRACE_MS).toISOString();
  const { rows: abandonedRooms } = await db.query<RoomRow>(
    `SELECT r.id
     FROM rooms r
     WHERE
       -- Has at least one non-home zone or some history (meaningful work was done)
       (
         EXISTS (
           SELECT 1 FROM room_node_positions rnp
           WHERE rnp.room_id = r.id AND rnp.zone_id != r.home_zone_id
         )
         OR EXISTS (
           SELECT 1 FROM room_node_memory rnm
           WHERE rnm.room_id = r.id AND rnm.zone_id != r.home_zone_id
         )
       )
       -- Must have been explicitly updated, and that update must be older than 5 days
       -- (no fallback to created_at — a room never updated is aborted, not abandoned)
       AND r.updated_at IS NOT NULL
       AND r.updated_at < $1`,
    [abandonedCutoff],
  );

  if (abandonedRooms.length > 0) {
    const abandonedIds = abandonedRooms.map((r) => r.id);
    const placeholders = abandonedIds.map((_, i) => `$${i + 1}`).join(', ');
    await db.query(`DELETE FROM rooms WHERE id IN (${placeholders})`, abandonedIds);
    console.log(`[roomCleanup] deleted ${abandonedIds.length} abandoned room(s)`);

    incrementGlobal(db, { rooms_abandoned: abandonedIds.length });
    incrementGlobalAlltime(db, { rooms_abandoned: abandonedIds.length });
  }
}

/**
 * Starts the room cleanup cron. Runs once per hour (every 3 600 000 ms).
 * Returns the interval handle so it can be cleared on server shutdown.
 */
export function startRoomCleanup(db: Pool): NodeJS.Timeout {
  // Run immediately on startup, then every hour
  runRoomCleanup(db).catch((err) =>
    console.error('[roomCleanup] error:', err),
  );

  // Schedule the cleanup to run every hour
  return setInterval(() => {
    runRoomCleanup(db).catch((err) =>
      console.error('[roomCleanup] error:', err),
    );
  }, 60 * 60 * 1000);
}
