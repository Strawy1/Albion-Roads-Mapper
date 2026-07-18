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
  await ctx.app.db.query(
    'UPDATE rooms SET plotted_route = $1, plotted_route_from_zone_id = $2, plotted_route_to_zone_id = $3, plotted_route_chain_id = $4 WHERE id = $5',
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
