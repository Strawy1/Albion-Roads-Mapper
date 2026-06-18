import { broadcast } from '../broadcast.js';
import { trackRoutePlotted } from '../routes/rooms_analytics.js';
import type { OperationHandler } from './types.js';
import type { ClientMessage } from 'shared';

export const handleUpdatePlotRoute: OperationHandler<Extract<ClientMessage, { type: 'update_plot_route' }>> = async (
  ctx,
  msg
) => {
  if (!ctx.authenticated) return;
  if (!ctx.verifySession()) return;
  const plottedRoute = Array.isArray(msg.plottedRoute) ? msg.plottedRoute : [];
  const destinationZoneId = msg.destinationZoneId;
  await ctx.app.db.query(
    'UPDATE rooms SET plotted_route = $1 WHERE id = $2',
    [plottedRoute.length > 0 ? plottedRoute : null, ctx.roomId]
  );
  broadcast(ctx.roomId, { type: 'plot_route_updated', plottedRoute, destinationZoneId }, ctx.socket);
  if (plottedRoute.length > 0) trackRoutePlotted(ctx.app.db, ctx.roomId);
};
