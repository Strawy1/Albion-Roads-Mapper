import { ZONE_BY_ID, normalizeRotationSteps, canonicalizeHandlesForRotation, type NodePosition, type CustomHandle } from 'shared';
import { broadcast } from '../broadcast.js';
import { trackRoomModified } from '../routes/rooms_analytics.js';
import type { OperationHandler } from './types.js';
import type { ClientMessage } from 'shared';

export const handleRotateZone: OperationHandler<Extract<ClientMessage, { type: 'rotate_zone' }>> = async (
  ctx,
  msg
) => {
  if (!ctx.authenticated) return;
  if (!ctx.verifySession()) return;
  if (!msg.zoneId || typeof msg.rotation !== 'number') return;

  const targetRotation = normalizeRotationSteps(msg.rotation);
  const zone = ZONE_BY_ID.get(msg.zoneId);
  if (!zone) return;

  const dbClient = await ctx.app.db.connect();
  let updatedPosition: NodePosition | null = null;
  try {
    await dbClient.query('BEGIN');
    // Lock the room row to serialize concurrent rotation/update operations.
    const { rows: roomRows } = await dbClient.query<{ home_zone_id: string }>(
      'SELECT home_zone_id FROM rooms WHERE id = $1 FOR UPDATE',
      [ctx.roomId]
    );
    if (!roomRows[0]) {
      await dbClient.query('ROLLBACK');
      return;
    }

    const { rows: existingRows } = await dbClient.query<{ zone_id: string; x: number; y: number; features: any; custom_handles: any; rotation: number; explored: boolean; chain_id: string | null }>(
      'SELECT zone_id, x, y, features, custom_handles, rotation, explored, chain_id FROM room_node_positions WHERE room_id = $1 AND zone_id = $2',
      [ctx.roomId, msg.zoneId]
    );
    const existing = existingRows[0];
    if (!existing) {
      await dbClient.query('ROLLBACK');
      return;
    }

    const incomingHandles = (existing.custom_handles ?? null) as CustomHandle[] | null;
    const canonicalHandles = canonicalizeHandlesForRotation(
      zone.type,
      zone.mapShape,
      incomingHandles,
      targetRotation,
    );

    await dbClient.query(
      'UPDATE room_node_positions SET rotation = $3, custom_handles = $4, explored = true WHERE room_id = $1 AND zone_id = $2',
      [ctx.roomId, msg.zoneId, targetRotation, JSON.stringify(canonicalHandles && canonicalHandles.length > 0 ? canonicalHandles : null)]
    );
    await dbClient.query(
      'UPDATE rooms SET updated_at = $1 WHERE id = $2',
      [new Date().toISOString(), ctx.roomId]
    );

    // Mirror the rotation/handles into room_node_memory (roads only),
    // so a future re-add of the same zone restores the rotated layout.
    if (zone.type === 'roads' || zone.type === 'roadsHideout') {
      await ctx.app.db.query(
        'UPDATE room_node_memory SET rotation = $3, custom_handles = $4, last_updated = $5 WHERE room_id = $1 AND zone_id = $2',
        [ctx.roomId, msg.zoneId, targetRotation, JSON.stringify(canonicalHandles && canonicalHandles.length > 0 ? canonicalHandles : null), new Date().toISOString()]
      );
    }

    await dbClient.query('COMMIT');

    updatedPosition = {
      zoneId: existing.zone_id,
      x: existing.x,
      y: existing.y,
      features: existing.features,
      customHandles: canonicalHandles,
      rotation: targetRotation,
      explored: true,
      chainId: existing.chain_id ?? undefined,
    };
  } catch (e) {
    await dbClient.query('ROLLBACK');
    throw e;
  } finally {
    dbClient.release();
  }

  if (updatedPosition) {
    // Re-broadcast the authoritative state to every client (including the
    // sender) so any client that desynced will converge on the corrected
    // rotation/handles automatically.
    broadcast(ctx.roomId, {
      type: 'node_positions_updated',
      nodePositions: [updatedPosition],
      updateLastUpdated: true,
    });
    trackRoomModified(ctx.app.db, ctx.roomId);
  }
};
