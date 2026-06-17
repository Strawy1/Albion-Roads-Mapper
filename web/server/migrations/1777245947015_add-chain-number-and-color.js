/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

// Default palette used when seeding a new chain. The first colour is reserved
// for the primary chain; subsequent chains cycle through the rest. Kept in
// sync with the client-side palette in `AddChainModal.vue`.
const DEFAULT_PALETTE = [
  '#10b981', // primary — emerald
  '#3b82f6', // blue
  '#ef4444', // red
  '#f59e0b', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#a78bfa', // light purple
];

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.addColumn('room_chains', {
    chain_number: { type: 'integer', notNull: false },
    chain_color: { type: 'text', notNull: false },
  });

  // Backfill chain_number per room (primary first by source matching room.home_zone_id,
  // then remaining chains by created_at ASC).
  pgm.sql(`
    WITH ordered AS (
      SELECT rc.id,
             ROW_NUMBER() OVER (
               PARTITION BY rc.room_id
               ORDER BY (CASE WHEN rc.source_zone_id = r.home_zone_id THEN 0 ELSE 1 END),
                        rc.created_at ASC,
                        rc.id ASC
             ) AS rn
      FROM room_chains rc
      JOIN rooms r ON r.id = rc.room_id
    )
    UPDATE room_chains rc
    SET chain_number = ordered.rn
    FROM ordered
    WHERE rc.id = ordered.id;
  `);

  // Backfill chain_color from the palette by chain_number. Chain 1 → primary
  // colour (index 1); chains 2..N cycle through the remaining palette entries
  // (indices 2..palette_length). Computed in a CTE so the subscript expression
  // is valid PostgreSQL syntax.
  const paletteValues = DEFAULT_PALETTE.map((c) => `'${c}'`).join(',');
  pgm.sql(`
    WITH palette AS (
      SELECT ARRAY[${paletteValues}]::text[] AS colors
    )
    UPDATE room_chains rc
    SET chain_color = (
      SELECT CASE
        WHEN rc.chain_number = 1 THEN p.colors[1]
        ELSE p.colors[2 + ((rc.chain_number - 2) % (array_length(p.colors, 1) - 1))]
      END
      FROM palette p
    )
    WHERE rc.chain_color IS NULL AND rc.chain_number IS NOT NULL;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.dropColumn('room_chains', 'chain_color');
  pgm.dropColumn('room_chains', 'chain_number');
};
