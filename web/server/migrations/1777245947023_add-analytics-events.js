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
  // Generic per-day event counters. One row per (event_type, Europe/London day);
  // all-time totals are derived as SUM(count) so new event types need no schema
  // changes — the client just starts sending a new type slug.
  pgm.createTable('analytics_events', {
    event_type: { type: 'text', notNull: true },
    date:       { type: 'date', notNull: true },
    count:      { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addConstraint('analytics_events', 'analytics_events_pkey', {
    primaryKey: ['event_type', 'date'],
  });
};

export const down = (pgm) => {
  pgm.dropTable('analytics_events');
};
