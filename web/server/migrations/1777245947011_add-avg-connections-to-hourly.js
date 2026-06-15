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
  pgm.addColumn('analytics_hourly_connections', {
    avg_connections: { type: 'numeric', notNull: true, default: 0 },
    sample_count: { type: 'integer', notNull: true, default: 0 },
  });
};

export const down = (pgm) => {
  pgm.dropColumn('analytics_hourly_connections', 'sample_count');
  pgm.dropColumn('analytics_hourly_connections', 'avg_connections');
};
