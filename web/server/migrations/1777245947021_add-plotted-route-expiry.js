/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Snapshot of when the currently plotted route stops being fully
  // traversable: MIN over the route's legs of each leg's connection expiry,
  // computed when the route is plotted. NULL when no route is plotted.
  pgm.addColumn('rooms', {
    plotted_route_expires_at: { type: 'timestamptz' },
  });

  // Backfill rooms that already have a plotted route, using the same
  // computation update_plot_route performs at plot time: per leg the
  // latest-expiring matching connection (either direction), then the earliest
  // leg across the route; a leg with no connection resolves to NOW().
  pgm.sql(`
    UPDATE rooms r
    SET plotted_route_expires_at = sub.route_expiry
    FROM (
      SELECT r2.id,
             (SELECT MIN(COALESCE(legs.leg_expiry, NOW()))
              FROM (
                SELECT MAX(c.expires_at) AS leg_expiry
                FROM generate_series(1, array_length(r2.plotted_route, 1) - 1) AS leg
                LEFT JOIN connections c ON c.room_id = r2.id
                  AND ((c.from_zone_id = r2.plotted_route[leg] AND c.to_zone_id = r2.plotted_route[leg + 1])
                    OR (c.from_zone_id = r2.plotted_route[leg + 1] AND c.to_zone_id = r2.plotted_route[leg]))
                GROUP BY leg
              ) legs) AS route_expiry
      FROM rooms r2
      WHERE COALESCE(array_length(r2.plotted_route, 1), 0) > 0
    ) sub
    WHERE r.id = sub.id
  `);
};

export const down = (pgm) => {
  pgm.dropColumn('rooms', 'plotted_route_expires_at');
};
