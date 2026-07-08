/**
 * Setos-Aiaitum and Setitos-Obobrom were incorrectly classified as roads
 * hideout maps. Any room history recorded against them reflects that bad
 * data, so it's removed rather than migrated.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(
    `DELETE FROM room_node_memory WHERE zone_id IN ('setos-aiaitum', 'setitos-obobrom')`,
  );
};

/**
 * Data deletion is irreversible.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = () => {};
