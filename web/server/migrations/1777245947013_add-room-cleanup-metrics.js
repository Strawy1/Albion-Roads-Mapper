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
  // Add per-day aborted/abandoned counters to the global daily table
  pgm.addColumn('analytics_global_daily', {
    rooms_aborted:   { type: 'integer', notNull: true, default: 0 },
    rooms_abandoned: { type: 'integer', notNull: true, default: 0 },
  });

  // All-time global totals — single-row table (id = 1, always upserted)
  pgm.createTable('analytics_global_alltime', {
    id:              { type: 'integer', primaryKey: true, default: 1 },
    rooms_aborted:   { type: 'integer', notNull: true, default: 0 },
    rooms_abandoned: { type: 'integer', notNull: true, default: 0 },
  });

  // Seed the single row so it always exists
  pgm.sql(`INSERT INTO analytics_global_alltime (id) VALUES (1) ON CONFLICT DO NOTHING`);
};

export const down = (pgm) => {
  pgm.dropTable('analytics_global_alltime');
  pgm.dropColumn('analytics_global_daily', 'rooms_abandoned');
  pgm.dropColumn('analytics_global_daily', 'rooms_aborted');
};
