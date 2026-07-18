import { broadcast } from '../broadcast.js';
import { trackRoutePlotted } from '../routes/rooms_analytics.js';
import type { OperationHandler } from './types.js';
import type { ClientMessage } from 'shared';

export const handleUpdatePlotRoute: OperationHandler<Extract<ClientMessage, { type: 'update_plot_route' }>> = async (
  ctx,
  msg
) => {
  if (!ctx.authenticated) return;
  if (!(await ctx.verifyWriteAccess())) return;
  const plottedRoute = Array.isArray(msg.plottedRoute) ? msg.plottedRoute : [];
  const fromZoneId = msg.fromZoneId ?? null;
  const toZoneId = msg.toZoneId ?? null;
  const chainId = msg.chainId ?? null;
  const hasRoute = plottedRoute.length > 0;
  // plotted_route_expires_at snapshots when the route stops being fully
  // traversable: per leg take the latest-expiring matching connection (either
  // direction), then take the earliest leg across the route. A leg with no
  // connection resolves to NOW() (route immediately inactive).
  await ctx.app.db.query(
    `UPDATE rooms SET plotted_route = $1::text[], plotted_route_from_zone_id = $2, plotted_route_to_zone_id = $3, plotted_route_chain_id = $4,
       plotted_route_expires_at = CASE WHEN $1::text[] IS NULL THEN NULL ELSE (
         SELECT MIN(COALESCE(legs.leg_expiry, NOW()))
         FROM (
           SELECT MAX(c.expires_at) AS leg_expiry
           FROM generate_series(1, COALESCE(array_length($1::text[], 1), 0) - 1) AS leg
           LEFT JOIN connections c ON c.room_id = $5
             AND ((c.from_zone_id = ($1::text[])[leg] AND c.to_zone_id = ($1::text[])[leg + 1])
               OR (c.from_zone_id = ($1::text[])[leg + 1] AND c.to_zone_id = ($1::text[])[leg]))
           GROUP BY leg
         ) legs
       ) END
     WHERE id = $5`,
    [
      hasRoute ? plottedRoute : null,
      hasRoute ? fromZoneId : null,
      hasRoute ? toZoneId : null,
      hasRoute ? chainId : null,
      ctx.roomId,
    ]
  );
  broadcast(ctx.roomId, { type: 'plot_route_updated', plottedRoute, fromZoneId: fromZoneId ?? undefined, toZoneId: toZoneId ?? undefined, chainId: chainId ?? undefined }, ctx.socket);
  if (hasRoute) trackRoutePlotted(ctx.app.db, ctx.roomId);
};
