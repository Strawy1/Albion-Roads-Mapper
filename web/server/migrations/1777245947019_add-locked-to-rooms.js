/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.addColumn('rooms', {
    locked: { type: 'boolean', notNull: true, default: false },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.dropColumn('rooms', 'locked');
};
