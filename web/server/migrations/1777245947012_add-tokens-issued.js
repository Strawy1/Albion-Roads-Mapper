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
  pgm.addColumn('analytics_global_daily', {
    tokens_issued: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addColumn('analytics_room_daily', {
    tokens_issued: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addColumn('analytics_room_alltime', {
    tokens_issued: { type: 'integer', notNull: true, default: 0 },
  });
};

export const down = (pgm) => {
  pgm.dropColumn('analytics_room_alltime', 'tokens_issued');
  pgm.dropColumn('analytics_room_daily', 'tokens_issued');
  pgm.dropColumn('analytics_global_daily', 'tokens_issued');
};
