import type { Pool } from 'pg';

/**
 * Single authoritative query used by both the HTTP `authenticate` preHandler
 * and the WebSocket write-access check. `web/server/test/testApp.ts` matches
 * on this exact SQL to route it to a dedicated mock (so per-route
 * mockResolvedValueOnce stacks are not consumed by the guard) — keep the two
 * in sync via the exported constant.
 */
export const ROOM_GUARD_SQL = 'SELECT password_version, locked FROM rooms WHERE id = $1';

export interface RoomGuardState {
  passwordVersion: number;
  locked: boolean;
}

export async function fetchRoomGuardState(db: Pool, roomId: string): Promise<RoomGuardState | null> {
  const { rows } = await db.query<{ password_version: number | null; locked: boolean | null }>(
    ROOM_GUARD_SQL,
    [roomId]
  );
  if (!rows[0]) return null;
  return {
    passwordVersion: rows[0].password_version ?? 1,
    locked: rows[0].locked ?? false,
  };
}
