/**
 * Adds from/to zone and chain metadata columns for the plotted route.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.addColumn('rooms', {
    plotted_route_from_zone_id: { type: 'text', notNull: false, default: null },
    plotted_route_to_zone_id: { type: 'text', notNull: false, default: null },
    plotted_route_chain_id: { type: 'text', notNull: false, default: null },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumn('rooms', 'plotted_route_from_zone_id');
  pgm.dropColumn('rooms', 'plotted_route_to_zone_id');
  pgm.dropColumn('rooms', 'plotted_route_chain_id');
};
