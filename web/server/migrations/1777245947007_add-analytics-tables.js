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
  // Global daily aggregates — one row per UTC date, created by midnight cron
  pgm.createTable('analytics_global_daily', {
    date:                 { type: 'date', primaryKey: true },
    rooms_created:        { type: 'integer', notNull: true, default: 0 },
    rooms_modified:       { type: 'integer', notNull: true, default: 0 },
    rooms_reset:          { type: 'integer', notNull: true, default: 0 },
    rooms_deleted:        { type: 'integer', notNull: true, default: 0 },
    memory_wiped_full:    { type: 'integer', notNull: true, default: 0 },
    memory_wiped_single:  { type: 'integer', notNull: true, default: 0 },
    passwords_rotated:    { type: 'integer', notNull: true, default: 0 },
    active_rooms:         { type: 'integer', notNull: true, default: 0 },
    inactive_rooms:       { type: 'integer', notNull: true, default: 0 },
    total_rooms:          { type: 'integer', notNull: true, default: 0 },
    peak_concurrent:         { type: 'integer', notNull: true, default: 0 },
    unique_tokens_active:    { type: 'integer', notNull: true, default: 0 },
    zones_added:             { type: 'integer', notNull: true, default: 0 },
    non_roads_zones_added:   { type: 'integer', notNull: true, default: 0 },
    room_data_updates:       { type: 'integer', notNull: true, default: 0 },
  });

  // Per-room daily stats — only rows with real activity, no zero rows
  // No FK on room_id so stats survive room deletion
  pgm.createTable('analytics_room_daily', {
    room_id:              { type: 'text', notNull: true },
    date:                 { type: 'date', notNull: true },
    data_updates:         { type: 'integer', notNull: true, default: 0 },
    zones_added_roads:    { type: 'integer', notNull: true, default: 0 },
    zones_added_nonroads: { type: 'integer', notNull: true, default: 0 },
    peak_concurrent:      { type: 'integer', notNull: true, default: 0 },
    unique_tokens:        { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addConstraint('analytics_room_daily', 'analytics_room_daily_pk', {
    primaryKey: ['room_id', 'date'],
  });
  pgm.createIndex('analytics_room_daily', 'date', { name: 'idx_analytics_room_daily_date' });

  // Per-room all-time totals — no FK so stats survive room deletion
  pgm.createTable('analytics_room_alltime', {
    room_id:              { type: 'text', primaryKey: true },
    data_updates:         { type: 'integer', notNull: true, default: 0 },
    zones_added_roads:    { type: 'integer', notNull: true, default: 0 },
    zones_added_nonroads: { type: 'integer', notNull: true, default: 0 },
    peak_concurrent:      { type: 'integer', notNull: true, default: 0 },
    unique_tokens:        { type: 'integer', notNull: true, default: 0 },
  });
};

export const down = (pgm) => {
  pgm.dropTable('analytics_room_alltime');
  pgm.dropTable('analytics_room_daily');
  pgm.dropTable('analytics_global_daily');
};
