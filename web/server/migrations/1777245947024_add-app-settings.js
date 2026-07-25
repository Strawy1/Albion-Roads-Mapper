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
  // Generic global key/value store for site-wide settings (no room scope).
  // First use: `client_version` — an opaque "reload generation" token. The
  // client snapshots it on load and polls it; bumping the value here (by hand,
  // e.g. `UPDATE app_settings SET value = value::int + 1 WHERE key = 'client_version'`)
  // makes every client that loaded an older value reload on its next poll.
  pgm.createTable('app_settings', {
    key:        { type: 'text', notNull: true, primaryKey: true },
    value:      { type: 'text', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql("INSERT INTO app_settings (key, value) VALUES ('client_version', '1');");
};

export const down = (pgm) => {
  pgm.dropTable('app_settings');
};
