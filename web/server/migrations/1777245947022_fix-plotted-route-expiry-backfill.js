/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * The backfill in 1777245947021 matched route legs as consecutive ZONE id
 * pairs, but rooms.plotted_route actually stores CONNECTION ids (the edges
 * the client's BFS traversed) — so no leg ever matched and every plotted
 * route was backfilled with NOW() (immediately inactive). Recompute the
 * snapshot correctly: MIN(expires_at) over the route's connections, with an
 * unknown connection id resolving to NOW().
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    UPDATE rooms r
    SET plotted_route_expires_at = (
      SELECT MIN(COALESCE(c.expires_at, NOW()))
      FROM unnest(r.plotted_route) AS conn_id
      LEFT JOIN connections c ON c.id = conn_id AND c.room_id = r.id
    )
    WHERE COALESCE(array_length(r.plotted_route, 1), 0) > 0
  `);
};

export const down = () => {
  // Data-only correction; nothing to revert.
};
