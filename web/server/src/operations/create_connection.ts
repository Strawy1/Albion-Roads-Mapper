import { randomUUID } from 'node:crypto';
import { ZONE_BY_ID, getDefaultHandles, inferRotationFromHandles } from 'shared';
import type { ClientMessage, Connection } from 'shared';
import { broadcast } from '../broadcast.js';
import { getInitialFeatures } from '../utils/nodeFeatures.js';
import { trackRoomModified, trackZoneAdded } from '../routes/rooms_analytics.js';
import type { OperationHandler } from './types.js';

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

export const handleCreateConnection: OperationHandler<Extract<ClientMessage, { type: 'create_connection' }>> = async (
  ctx,
  msg
) => {
  if (!ctx.authenticated) return;
  if (!(await ctx.verifyWriteAccess())) return;

  const { fromZoneId, toZoneId, fromHandleId, toHandleId, reportedBy, targetPosition } = msg;
  const permanent = msg.permanent === true;
  const secondsRemaining = msg.secondsRemaining;
  const slots = msg.slots;

  if (fromZoneId === toZoneId) {
    ctx.send({ type: 'error', message: 'You cannot have same-zone connections' });
    return;
  }

  if (!ZONE_BY_ID.has(fromZoneId)) {
    ctx.send({ type: 'error', message: 'fromZoneId not found in zone catalogue' });
    return;
  }

  if (!ZONE_BY_ID.has(toZoneId)) {
    ctx.send({ type: 'error', message: 'toZoneId not found in zone catalogue' });
    return;
  }

  // Resolve chain membership for fromZoneId
  const { rows: fromChainRows } = await ctx.app.db.query<{ chain_id: string | null }>(
    'SELECT chain_id FROM room_node_positions WHERE room_id = $1 AND zone_id = $2',
    [ctx.roomId, fromZoneId]
  );
  if (fromChainRows.length === 0 || !fromChainRows[0].chain_id) {
    ctx.send({ type: 'error', message: 'Source zone is not part of any chain in this room' });
    return;
  }
  const sourceChainId = fromChainRows[0].chain_id;

  // Reject cross-chain connections
  const { rows: toChainRows } = await ctx.app.db.query<{ chain_id: string | null }>(
    'SELECT chain_id FROM room_node_positions WHERE room_id = $1 AND zone_id = $2',
    [ctx.roomId, toZoneId]
  );
  if (toChainRows[0] && toChainRows[0].chain_id && toChainRows[0].chain_id !== sourceChainId) {
    ctx.send({ type: 'error', message: 'Connections may not bridge two different chains' });
    return;
  }

  // Reject cycles
  const { rows: dbConnections } = await ctx.app.db.query<{ id: string; from_zone_id: string; to_zone_id: string; from_handle_id: string | null; to_handle_id: string | null; expires_at: string; reported_at: string; reported_by: string | null; chain_id: string | null }>(
    'SELECT * FROM connections WHERE room_id = $1',
    [ctx.roomId]
  );
  const cycleExists = dbConnections.some(c =>
    (c.from_zone_id === toZoneId && c.to_zone_id === fromZoneId) ||
    (c.from_zone_id === fromZoneId && c.to_zone_id === toZoneId)
  );
  if (cycleExists) {
    ctx.send({ type: 'error', message: 'This connection would create a cycle' });
    return;
  }

  // Validate source handle not occupied
  const normalizedFromHandle = fromHandleId || 'center';
  const sourceHandleOccupied = dbConnections.find(c =>
    (c.from_zone_id === fromZoneId && (c.from_handle_id === normalizedFromHandle || (!c.from_handle_id && normalizedFromHandle === 'center'))) ||
    (c.to_zone_id === fromZoneId && (c.to_handle_id === normalizedFromHandle || (!c.to_handle_id && normalizedFromHandle === 'center')))
  );
  if (sourceHandleOccupied) {
    ctx.send({ type: 'error', message: 'A connection already exists on this source handle' });
    return;
  }

  const now = new Date();
  const lastUpdateMs = now.getTime();

  if (targetPosition) {
    const toZone = ZONE_BY_ID.get(toZoneId);
    const isRoads = toZone?.type === 'roads' || toZone?.type === 'roadsHideout';

    let memoryEntry = null;
    if (isRoads) {
      const { rows: memoryCheck } = await ctx.app.db.query<{ features: any; custom_handles: any; rotation: number }>(
        'SELECT features, custom_handles, rotation FROM room_node_memory WHERE room_id = $1 AND zone_id = $2',
        [ctx.roomId, toZoneId]
      );
      memoryEntry = memoryCheck[0];
    }

    const baseFeatures = memoryEntry?.features ?? getInitialFeatures(toZoneId);
    const initialFeatures = { ...baseFeatures, slots, lastUpdatedAt: lastUpdateMs };
    let initialHandles = memoryEntry?.custom_handles ?? null;
    let initialRotation = memoryEntry?.rotation ?? 0;

    if (initialHandles && toZone?.mapShape && toZone.type !== 'roadsHideout') {
      const expectedHandles = getDefaultHandles(toZone.type, toZone.mapShape);
      const inferredRotation = inferRotationFromHandles(initialHandles, expectedHandles);
      if (inferredRotation === null) {
        initialHandles = expectedHandles.map((expected: { id: string; top: string; left: string }) => {
          const stale = initialHandles.find((h: { id: string; disabled?: boolean }) => h.id === expected.id);
          return stale?.disabled ? { ...expected, disabled: true } : expected;
        });
        initialRotation = 0;
      }
    }

    let isNewNonRoadsZone = false;
    if (!isRoads) {
      const { rows: existingPos } = await ctx.app.db.query<{ zone_id: string }>(
        'SELECT zone_id FROM room_node_positions WHERE room_id = $1 AND zone_id = $2',
        [ctx.roomId, toZoneId]
      );
      isNewNonRoadsZone = existingPos.length === 0;
    }

    await ctx.app.db.query(`
      INSERT INTO room_node_positions (room_id, zone_id, x, y, features, custom_handles, explored, rotation, chain_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (room_id, zone_id) DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y, features = EXCLUDED.features, custom_handles = EXCLUDED.custom_handles, rotation = EXCLUDED.rotation, chain_id = COALESCE(room_node_positions.chain_id, EXCLUDED.chain_id)
    `, [ctx.roomId, toZoneId, targetPosition.x, targetPosition.y, JSON.stringify(initialFeatures), JSON.stringify(initialHandles), false, initialRotation, sourceChainId]);

    if (isNewNonRoadsZone) {
      trackZoneAdded(ctx.app.db, ctx.roomId, false);
    }

    const { rows: memRows } = await ctx.app.db.query<{ times_added: string[] }>(
      'SELECT times_added FROM room_node_memory WHERE room_id = $1 AND zone_id = $2',
      [ctx.roomId, toZoneId]
    );
    const existingMem = memRows[0];
    const shouldAppend = isRoads && (!existingMem ||
      existingMem.times_added.length === 0 ||
      (now.getTime() - new Date(existingMem.times_added[existingMem.times_added.length - 1]).getTime()) > THREE_HOURS_MS);
    const handlesWereCorrected = isRoads && existingMem && memoryEntry?.custom_handles !== initialHandles;

    if (shouldAppend) {
      await ctx.app.db.query(`
        INSERT INTO room_node_memory (room_id, zone_id, times_added, features, custom_handles, last_updated)
        VALUES ($1, $2, ARRAY[$3::timestamptz], $4, $5, $3::timestamptz)
        ON CONFLICT (room_id, zone_id) DO UPDATE
          SET times_added = room_node_memory.times_added || ARRAY[$3::timestamptz],
              features = EXCLUDED.features,
              custom_handles = EXCLUDED.custom_handles,
              last_updated = EXCLUDED.last_updated
      `, [ctx.roomId, toZoneId, now.toISOString(), JSON.stringify(initialFeatures), JSON.stringify(initialHandles)]);
      trackZoneAdded(ctx.app.db, ctx.roomId, true);
    } else if (handlesWereCorrected) {
      await ctx.app.db.query(`
        UPDATE room_node_memory
        SET custom_handles = $1, features = $2, last_updated = $3
        WHERE room_id = $4 AND zone_id = $5
      `, [JSON.stringify(initialHandles), JSON.stringify(initialFeatures), now.toISOString(), ctx.roomId, toZoneId]);
    }
  } else {
    await ctx.app.db.query(`
      UPDATE room_node_positions
      SET features = jsonb_set(
        jsonb_set(COALESCE(features, '{}'), '{slots}', $1::jsonb),
        '{lastUpdatedAt}', $2::jsonb
      )
      WHERE room_id = $3 AND zone_id = $4
    `, [JSON.stringify(slots), JSON.stringify(lastUpdateMs), ctx.roomId, toZoneId]);
  }

  // Update lastUpdatedAt for the source zone
  await ctx.app.db.query(`
    UPDATE room_node_positions
    SET features = jsonb_set(COALESCE(features, '{}'), '{lastUpdatedAt}', $1::jsonb)
    WHERE room_id = $2 AND zone_id = $3
  `, [JSON.stringify(lastUpdateMs), ctx.roomId, fromZoneId]);

  const { rows: positions } = await ctx.app.db.query<{ zone_id: string; x: number; y: number; features: any; custom_handles: any; rotation: number; chain_id: string | null }>(
    'SELECT zone_id, x, y, features, custom_handles, rotation, chain_id FROM room_node_positions WHERE room_id = $1',
    [ctx.roomId]
  );
  const nodePositions = positions.map(p => ({
    zoneId: p.zone_id,
    x: p.x,
    y: p.y,
    features: p.features,
    customHandles: p.custom_handles,
    rotation: p.rotation,
    chainId: p.chain_id ?? undefined,
  }));

  broadcast(ctx.roomId, { type: 'node_positions_updated', nodePositions });
  trackRoomModified(ctx.app.db, ctx.roomId);

  const connId = randomUUID();
  const reportedAt = now.toISOString();
  // Permanent connections use a far-future expiry (100 years from now)
  const expiresAt = permanent
    ? new Date(now.getTime() + 100 * 365.25 * 24 * 60 * 60 * 1000).toISOString()
    : new Date(now.getTime() + (secondsRemaining ?? 3600) * 1000).toISOString();

  await ctx.app.db.query(`
    INSERT INTO connections (id, room_id, from_zone_id, to_zone_id, from_handle_id, to_handle_id, expires_at, reported_at, reported_by, chain_id, permanent)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `, [connId, ctx.roomId, fromZoneId, toZoneId, fromHandleId ?? null, toHandleId ?? null, expiresAt, reportedAt, reportedBy ?? null, sourceChainId, permanent]);

  const connection: Connection = {
    id: connId,
    roomId: ctx.roomId,
    fromZoneId,
    toZoneId,
    fromHandleId: fromHandleId ?? undefined,
    toHandleId: toHandleId ?? undefined,
    expiresAt,
    reportedAt,
    reportedBy: reportedBy ?? undefined,
    chainId: sourceChainId,
    permanent: permanent || undefined,
  };

  broadcast(ctx.roomId, { type: 'connection_added', connection });
};
