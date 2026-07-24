/**
 * Room cleanup tests.
 *
 * Verifies that runRoomCleanup correctly identifies and deletes aborted and
 * abandoned rooms, and increments the appropriate analytics counters.
 *
 * Uses the mockDb pattern — all DB calls are intercepted via vi.fn() so no
 * real database is required.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runRoomCleanup } from '../src/roomCleanup.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasQuery(mockDb: any, fragment: string): boolean {
  return mockDb.query.mock.calls.some((c: any[]) => {
    const sql: string = typeof c[0] === 'string' ? c[0] : '';
    return sql.includes(fragment);
  });
}

function deletedIds(mockDb: any): string[] {
  for (const call of mockDb.query.mock.calls) {
    const sql: string = typeof call[0] === 'string' ? call[0] : '';
    if (sql.startsWith('DELETE FROM rooms')) {
      return call[1] as string[];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mockDb: any;

beforeEach(() => {
  mockDb = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  };
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Aborted rooms
// ---------------------------------------------------------------------------

describe('runRoomCleanup — aborted rooms', () => {
  it('deletes rooms that were created but never used and are older than 5 days', async () => {
    const roomId = 'aborted-room-1';

    // First query returns the aborted rooms; second (abandoned) returns none.
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: roomId }] }) // aborted SELECT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })   // aborted DELETE
      .mockResolvedValueOnce({ rows: [] })                // aborted incrementGlobal INSERT (fire-and-forget, may not be awaited)
      .mockResolvedValueOnce({ rows: [{ id: roomId }] }) // alltime increment (fire-and-forget)
      .mockResolvedValueOnce({ rows: [] });               // abandoned SELECT

    await runRoomCleanup(mockDb);

    // A DELETE targeting the aborted room must have been issued
    const deleted = deletedIds(mockDb);
    expect(deleted).toContain(roomId);
  });

  it('increments analytics_global_daily rooms_aborted for aborted rooms', async () => {
    const roomId = 'aborted-room-2';

    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: roomId }] }) // aborted SELECT
      .mockResolvedValue({ rows: [] });                   // everything else

    await runRoomCleanup(mockDb);

    // The daily analytics insert/upsert must reference rooms_aborted
    expect(hasQuery(mockDb, 'rooms_aborted')).toBe(true);
  });

  it('increments analytics_global_alltime rooms_aborted for aborted rooms', async () => {
    const roomId = 'aborted-room-3';

    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: roomId }] }) // aborted SELECT
      .mockResolvedValue({ rows: [] });                   // everything else

    await runRoomCleanup(mockDb);

    expect(hasQuery(mockDb, 'analytics_global_alltime')).toBe(true);
  });

  it('does nothing when there are no aborted rooms', async () => {
    // Both selects return empty
    mockDb.query.mockResolvedValue({ rows: [] });

    await runRoomCleanup(mockDb);

    // No DELETE should have been issued
    const deleted = deletedIds(mockDb);
    expect(deleted).toHaveLength(0);
  });

  it('deletes multiple aborted rooms in a single DELETE call', async () => {
    const ids = ['aborted-a', 'aborted-b', 'aborted-c'];

    mockDb.query
      .mockResolvedValueOnce({ rows: ids.map((id) => ({ id })) }) // aborted SELECT
      .mockResolvedValue({ rows: [] });                             // everything else

    await runRoomCleanup(mockDb);

    const deleted = deletedIds(mockDb);
    expect(deleted).toEqual(expect.arrayContaining(ids));
    expect(deleted).toHaveLength(ids.length);
  });

  it('uses the aborted rooms cutoff based on COALESCE(updated_at, created_at)', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });

    await runRoomCleanup(mockDb);

    // The SELECT for aborted rooms must include the COALESCE logic
    const abortedSelectCall = mockDb.query.mock.calls.find((c: any[]) => {
      const sql: string = typeof c[0] === 'string' ? c[0] : '';
      return sql.includes('room_node_positions') && sql.includes('COALESCE');
    });
    expect(abortedSelectCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Abandoned rooms
// ---------------------------------------------------------------------------

describe('runRoomCleanup — abandoned rooms', () => {
  it('deletes rooms that had meaningful content but were not updated for 30 days', async () => {
    const roomId = 'abandoned-room-1';

    mockDb.query
      .mockResolvedValueOnce({ rows: [] })               // aborted SELECT (none)
      .mockResolvedValueOnce({ rows: [{ id: roomId }] }) // abandoned SELECT
      .mockResolvedValue({ rows: [] });                   // everything else

    await runRoomCleanup(mockDb);

    const deleted = deletedIds(mockDb);
    expect(deleted).toContain(roomId);
  });

  it('increments analytics_global_daily rooms_abandoned for abandoned rooms', async () => {
    const roomId = 'abandoned-room-2';

    mockDb.query
      .mockResolvedValueOnce({ rows: [] })               // aborted SELECT
      .mockResolvedValueOnce({ rows: [{ id: roomId }] }) // abandoned SELECT
      .mockResolvedValue({ rows: [] });                   // everything else

    await runRoomCleanup(mockDb);

    expect(hasQuery(mockDb, 'rooms_abandoned')).toBe(true);
  });

  it('increments analytics_global_alltime rooms_abandoned for abandoned rooms', async () => {
    const roomId = 'abandoned-room-3';

    mockDb.query
      .mockResolvedValueOnce({ rows: [] })               // aborted SELECT
      .mockResolvedValueOnce({ rows: [{ id: roomId }] }) // abandoned SELECT
      .mockResolvedValue({ rows: [] });                   // everything else

    await runRoomCleanup(mockDb);

    expect(hasQuery(mockDb, 'analytics_global_alltime')).toBe(true);
  });

  it('deletes multiple abandoned rooms in a single DELETE call', async () => {
    const ids = ['abandoned-x', 'abandoned-y'];

    mockDb.query
      .mockResolvedValueOnce({ rows: [] })               // aborted SELECT
      .mockResolvedValueOnce({ rows: ids.map((id) => ({ id })) }) // abandoned SELECT
      .mockResolvedValue({ rows: [] });                   // everything else

    await runRoomCleanup(mockDb);

    const deleted = deletedIds(mockDb);
    expect(deleted).toEqual(expect.arrayContaining(ids));
    expect(deleted).toHaveLength(ids.length);
  });

  it('does nothing for abandoned when there are no qualifying rooms', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });

    await runRoomCleanup(mockDb);

    const deleted = deletedIds(mockDb);
    expect(deleted).toHaveLength(0);
  });

  it('uses updated_at IS NOT NULL for abandoned cutoff (no created_at fallback)', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });

    await runRoomCleanup(mockDb);

    // The SELECT for abandoned rooms must require updated_at IS NOT NULL, not COALESCE
    const abandonedSelectCall = mockDb.query.mock.calls.find((c: any[]) => {
      const sql: string = typeof c[0] === 'string' ? c[0] : '';
      return sql.includes('room_node_memory') && sql.includes('updated_at IS NOT NULL');
    });
    expect(abandonedSelectCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Mixed: aborted and abandoned in the same tick
// ---------------------------------------------------------------------------

describe('runRoomCleanup — mixed aborted and abandoned in one tick', () => {
  it('handles both types in a single call and issues two DELETE statements', async () => {
    const abortedId   = 'room-aborted';
    const abandonedId = 'room-abandoned';

    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: abortedId }] })   // aborted SELECT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })         // aborted DELETE
      .mockResolvedValueOnce({ rows: [] })                      // aborted daily analytics (fire-and-forget)
      .mockResolvedValueOnce({ rows: [] })                      // aborted alltime analytics (fire-and-forget)
      .mockResolvedValueOnce({ rows: [{ id: abandonedId }] })  // abandoned SELECT
      .mockResolvedValue({ rows: [] });                          // remaining calls

    await runRoomCleanup(mockDb);

    // Both IDs must have been targeted by separate DELETE statements
    const deleteCalls = mockDb.query.mock.calls.filter((c: any[]) => {
      const sql: string = typeof c[0] === 'string' ? c[0] : '';
      return sql.startsWith('DELETE FROM rooms');
    });
    expect(deleteCalls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Error resilience
// ---------------------------------------------------------------------------

describe('runRoomCleanup — error resilience', () => {
  it('propagates DB errors (caller is expected to catch)', async () => {
    mockDb.query.mockRejectedValueOnce(new Error('DB connection lost'));

    await expect(runRoomCleanup(mockDb)).rejects.toThrow('DB connection lost');
  });
});
