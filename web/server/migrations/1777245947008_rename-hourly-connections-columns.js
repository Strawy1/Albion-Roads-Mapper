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
  pgm.renameColumn('analytics_hourly_connections', 'connections', 'max_connections');
  pgm.addColumn('analytics_hourly_connections', {
    min_connections: { type: 'integer', notNull: true, default: 0 },
  });
};

export const down = (pgm) => {
  pgm.dropColumn('analytics_hourly_connections', 'min_connections');
  pgm.renameColumn('analytics_hourly_connections', 'max_connections', 'connections');
};
