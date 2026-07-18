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
  // Exact timestamp of the most recent route plot, per room and globally.
  // NULL for history predating this column (metrics fall back to the daily
  // routes_plotted buckets, which are day-granularity).
  pgm.addColumn('analytics_room_alltime', {
    routes_last_plotted_at: { type: 'timestamptz' },
  });
  pgm.addColumn('analytics_global_alltime', {
    routes_last_plotted_at: { type: 'timestamptz' },
  });
};

export const down = (pgm) => {
  pgm.dropColumn('analytics_global_alltime', 'routes_last_plotted_at');
  pgm.dropColumn('analytics_room_alltime', 'routes_last_plotted_at');
};
