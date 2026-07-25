/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  // Which Albion game server a room's map data comes from ('eu' | 'us' | 'asia').
  // Nullable on purpose: every pre-existing room starts unassigned and gets
  // labelled by the in-room prompt, so analytics queries must handle NULL.
  pgm.addColumn('rooms', {
    server: { type: 'text' },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.dropColumn('rooms', 'server');
};
