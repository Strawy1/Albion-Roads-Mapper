import type { Pool } from 'pg';

export interface GlobalDailyCounters {
  rooms_created?: number;
  rooms_modified?: number;
  rooms_reset?: number;
  rooms_deleted?: number;
  rooms_aborted?: number;
  rooms_abandoned?: number;
  memory_wiped_full?: number;
  memory_wiped_single?: number;
  passwords_rotated?: number;
  zones_added?: number;
  non_roads_zones_added?: number;
  room_data_updates?: number;
  routes_plotted?: number;
  tokens_issued?: number;
}

export interface GlobalAlltimeCounters {
  rooms_aborted?: number;
  rooms_abandoned?: number;
}

export interface RoomDailyCounters {
  data_updates?: number;
  zones_added_roads?: number;
  zones_added_nonroads?: number;
  routes_plotted?: number;
  tokens_issued?: number;
}

export interface RoomAlltimeCounters {
  data_updates?: number;
  zones_added_roads?: number;
  zones_added_nonroads?: number;
  peak_concurrent?: number;
  unique_tokens?: number;
  tokens_issued?: number;
  routes_plotted?: number;
}

/** Returns today's date as a YYYY-MM-DD string in Europe/London. */
export function londonDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d).split('/').reverse().join('-');
}


/**
 * Increments one or more counters on the all-time global row (id = 1).
 * Creates the row if it doesn't exist yet.
 * Fire-and-forget — never throws.
 */
export function incrementGlobalAlltime(db: Pool, counters: GlobalAlltimeCounters): void {
  const entries = Object.entries(counters).filter(([, v]) => v && v > 0);
  if (entries.length === 0) return;

  const setClauses = entries
    .map(([col]) => `${col} = analytics_global_alltime.${col} + EXCLUDED.${col}`)
    .join(', ');
  const cols = ['id', ...entries.map(([col]) => col)].join(', ');
  const placeholders = ['1', ...entries.map((_, i) => `$${i + 1}`)].join(', ');
  const values = entries.map(([, v]) => v);

  void db
    .query(
      `INSERT INTO analytics_global_alltime (${cols}) VALUES (${placeholders})
       ON CONFLICT (id) DO UPDATE SET ${setClauses}`,
      values,
    )
    .catch((err) => console.error('[analytics] incrementGlobalAlltime error:', err));
}

/**
 * Increments one or more counters on the global daily row for today.
 * Creates the row if it doesn't exist yet.
 * Fire-and-forget — never throws.
 */
export function incrementGlobal(db: Pool, counters: GlobalDailyCounters): void {
  const entries = Object.entries(counters).filter(([, v]) => v && v > 0);
  if (entries.length === 0) return;

  const today = londonDateString();
  const setClauses = entries
    .map(([col]) => `${col} = analytics_global_daily.${col} + EXCLUDED.${col}`)
    .join(', ');
  const cols = ['date', ...entries.map(([col]) => col)].join(', ');
  const placeholders = ['$1', ...entries.map((_, i) => `$${i + 2}`)].join(', ');
  const values = [today, ...entries.map(([, v]) => v)];

  void db
    .query(
      `INSERT INTO analytics_global_daily (${cols}) VALUES (${placeholders})
       ON CONFLICT (date) DO UPDATE SET ${setClauses}`,
      values,
    )
    .catch((err) => console.error('[analytics] incrementGlobal error:', err));
}

/**
 * Increments a generic event counter for today's Europe/London day bucket.
 * Event types are open slugs (validated at the route layer) so new events
 * need no schema or server changes. All-time totals are SUM(count) over days.
 * Fire-and-forget — never throws.
 */
export function incrementEvent(db: Pool, eventType: string): void {
  const today = londonDateString();
  void db
    .query(
      `INSERT INTO analytics_events (event_type, date, count) VALUES ($1, $2, 1)
       ON CONFLICT (event_type, date) DO UPDATE SET count = analytics_events.count + 1`,
      [eventType, today],
    )
    .catch((err) => console.error('[analytics] incrementEvent error:', err));
}

/**
 * Increments per-room daily counters.
 * Creates the row only when there is real activity (no zero rows ever written).
 * Also recalculates active_rooms / inactive_rooms / total_rooms on the global row for today.
 * Fire-and-forget — never throws.
 */
export function incrementRoomDaily(db: Pool, roomId: string, counters: RoomDailyCounters): void {
  const entries = Object.entries(counters).filter(([, v]) => v && v > 0);
  if (entries.length === 0) return;

  const today = londonDateString();
  const setClauses = entries
    .map(([col]) => `${col} = analytics_room_daily.${col} + EXCLUDED.${col}`)
    .join(', ');
  const cols = ['room_id', 'date', ...entries.map(([col]) => col)].join(', ');
  const placeholders = ['$1', '$2', ...entries.map((_, i) => `$${i + 3}`)].join(', ');
  const values = [roomId, today, ...entries.map(([, v]) => v)];

  void db
    .query(
      `INSERT INTO analytics_room_daily (${cols}) VALUES (${placeholders})
       ON CONFLICT (room_id, date) DO UPDATE SET ${setClauses}`,
      values,
    )
    .then(() => recalculateRoomCounts(db, today))
    .catch((err) => console.error('[analytics] incrementRoomDaily error:', err));
}

/**
 * Increments per-room all-time counters.
 * Fire-and-forget — never throws.
 */
export function incrementRoomAlltime(db: Pool, roomId: string, counters: RoomAlltimeCounters): void {
  const entries = Object.entries(counters).filter(([, v]) => v && v > 0);
  if (entries.length === 0) return;

  const setClauses = entries
    .map(([col]) => `${col} = analytics_room_alltime.${col} + EXCLUDED.${col}`)
    .join(', ');
  const cols = ['room_id', ...entries.map(([col]) => col)].join(', ');
  const placeholders = ['$1', ...entries.map((_, i) => `$${i + 2}`)].join(', ');
  const values = [roomId, ...entries.map(([, v]) => v)];

  void db
    .query(
      `INSERT INTO analytics_room_alltime (${cols}) VALUES (${placeholders})
       ON CONFLICT (room_id) DO UPDATE SET ${setClauses}`,
      values,
    )
    .catch((err) => console.error('[analytics] incrementRoomAlltime error:', err));
}

/**
 * Records the exact time a route was plotted, per room and globally.
 * Fire-and-forget — never throws.
 */
export function recordRouteLastPlotted(db: Pool, roomId: string): void {
  void db
    .query(
      `INSERT INTO analytics_room_alltime (room_id, routes_last_plotted_at) VALUES ($1, NOW())
       ON CONFLICT (room_id) DO UPDATE SET routes_last_plotted_at = NOW()`,
      [roomId],
    )
    .catch((err) => console.error('[analytics] recordRouteLastPlotted (room) error:', err));
  void db
    .query(
      `INSERT INTO analytics_global_alltime (id, routes_last_plotted_at) VALUES (1, NOW())
       ON CONFLICT (id) DO UPDATE SET routes_last_plotted_at = NOW()`,
    )
    .catch((err) => console.error('[analytics] recordRouteLastPlotted (global) error:', err));
}

/**
 * Recalculates active_rooms, inactive_rooms, and total_rooms on the global daily row for a given
 * UTC date string (YYYY-MM-DD). Called after every analytics_room_daily upsert and after a room
 * deletion so the snapshot always reflects current reality.
 * Fire-and-forget — never throws.
 */
export function recalculateRoomCounts(db: Pool, date: string): void {
  void db
    .query(
      `INSERT INTO analytics_global_daily (date, total_rooms, active_rooms, inactive_rooms, rooms_modified)
       VALUES (
         $1,
         (SELECT COUNT(*) FROM rooms),
         (SELECT COUNT(DISTINCT room_id) FROM analytics_room_daily WHERE date = $1),
         (SELECT COUNT(*) FROM rooms)
           - (SELECT COUNT(DISTINCT room_id) FROM analytics_room_daily WHERE date = $1),
         (SELECT COUNT(DISTINCT room_id) FROM analytics_room_daily WHERE date = $1)
       )
       ON CONFLICT (date) DO UPDATE SET
         total_rooms    = (SELECT COUNT(*) FROM rooms),
         active_rooms   = (SELECT COUNT(DISTINCT room_id) FROM analytics_room_daily WHERE date = $1),
         inactive_rooms = (SELECT COUNT(*) FROM rooms)
           - (SELECT COUNT(DISTINCT room_id) FROM analytics_room_daily WHERE date = $1),
         rooms_modified = (SELECT COUNT(DISTINCT room_id) FROM analytics_room_daily WHERE date = $1)`,
      [date],
    )
    .catch((err) => console.error('[analytics] recalculateRoomCounts error:', err));
}

/**
 * Upserts peak_concurrent and unique_tokens on the room daily row and updates the global row.
 * Called from the analytics cron flush tick.
 * Returns a promise so the cron can await it.
 */
export async function flushConcurrencyStats(
  db: Pool,
  roomId: string,
  date: string,
  peakConcurrent: number,
  uniqueTokens: number,
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO analytics_room_daily
         (room_id, date, peak_concurrent, unique_tokens)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (room_id, date) DO UPDATE SET
         peak_concurrent = GREATEST(analytics_room_daily.peak_concurrent, EXCLUDED.peak_concurrent),
         unique_tokens   = GREATEST(analytics_room_daily.unique_tokens,   EXCLUDED.unique_tokens)`,
      [roomId, date, peakConcurrent, uniqueTokens],
    );
    // Also keep all-time peak and unique_tokens up to date
    await db.query(
      `INSERT INTO analytics_room_alltime (room_id, peak_concurrent, unique_tokens)
       VALUES ($1, $2, $3)
       ON CONFLICT (room_id) DO UPDATE SET
         peak_concurrent = GREATEST(analytics_room_alltime.peak_concurrent, EXCLUDED.peak_concurrent),
         unique_tokens   = GREATEST(analytics_room_alltime.unique_tokens,   EXCLUDED.unique_tokens)`,
      [roomId, peakConcurrent, uniqueTokens],
    );
  } catch (err) {
    console.error('[analytics] flushConcurrencyStats error:', err);
  }
}

/**
 * Updates peak_concurrent and unique_tokens_active on the global daily row.
 * Called from the analytics cron flush tick.
 */
export async function flushGlobalConcurrencyStats(
  db: Pool,
  date: string,
  peakConcurrent: number,
  uniqueTokensActive: number,
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO analytics_global_daily (date, peak_concurrent, unique_tokens_active)
       VALUES ($1, $2, $3)
       ON CONFLICT (date) DO UPDATE SET
         peak_concurrent      = GREATEST(analytics_global_daily.peak_concurrent,      EXCLUDED.peak_concurrent),
         unique_tokens_active = GREATEST(analytics_global_daily.unique_tokens_active, EXCLUDED.unique_tokens_active)`,
      [date, peakConcurrent, uniqueTokensActive],
    );
  } catch (err) {
    console.error('[analytics] flushGlobalConcurrencyStats error:', err);
  }
}
