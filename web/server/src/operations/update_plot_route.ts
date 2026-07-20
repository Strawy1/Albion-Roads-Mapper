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
  // plottedRoute holds CONNECTION ids (the edges the client's BFS traversed),
  // so the route stops being traversable when its soonest connection expires.
  // plotted_route_expires_at snapshots that: MIN(expires_at) over the route's
  // connections; an id with no matching connection resolves to NOW() (route
  // immediately inactive).
  await ctx.app.db.query(
    `UPDATE rooms SET plotted_route = $1::text[], plotted_route_from_zone_id = $2, plotted_route_to_zone_id = $3, plotted_route_chain_id = $4,
       plotted_route_expires_at = CASE WHEN $1::text[] IS NULL THEN NULL ELSE (
         SELECT MIN(COALESCE(c.expires_at, NOW()))
         FROM unnest($1::text[]) AS conn_id
         LEFT JOIN connections c ON c.id = conn_id AND c.room_id = $5
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
