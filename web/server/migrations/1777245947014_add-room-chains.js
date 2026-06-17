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
  pgm.createTable('room_chains', {
    id: { type: 'text', primaryKey: true },
    room_id: {
      type: 'text',
      notNull: true,
      references: '"rooms"',
      onDelete: 'CASCADE',
    },
    source_zone_id: { type: 'text', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createIndex('room_chains', 'room_id', { name: 'idx_room_chains_room' });

  pgm.addColumn('connections', {
    chain_id: {
      type: 'text',
      notNull: false,
      references: '"room_chains"',
      onDelete: 'CASCADE',
    },
  });

  pgm.addColumn('room_node_positions', {
    chain_id: {
      type: 'text',
      notNull: false,
      references: '"room_chains"',
      onDelete: 'CASCADE',
    },
  });

  pgm.addColumn('rooms', {
    chain_migrated: { type: 'boolean', notNull: true, default: false },
  });
};

export const down = (pgm) => {
  pgm.dropColumn('rooms', 'chain_migrated');
  pgm.dropColumn('room_node_positions', 'chain_id');
  pgm.dropColumn('connections', 'chain_id');
  pgm.dropTable('room_chains');
};
