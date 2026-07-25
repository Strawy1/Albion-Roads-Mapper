import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — migrations are plain JS with no type declarations.
import { up, down } from '../migrations/1777245947024_add-app-settings.js';

/**
 * The pg Pool is mocked across the server suite, so migrations are never
 * executed in tests — a broken one would only surface when the server next
 * boots. This exercises the builder calls to catch that earlier.
 */
const makeStubBuilder = () => ({
  createTable: vi.fn(),
  dropTable: vi.fn(),
  sql: vi.fn(),
  func: vi.fn((expr: string) => ({ __func: expr })),
});

describe('migration: add-app-settings', () => {
  it('creates app_settings keyed by `key` and seeds the client_version token', () => {
    const pgm = makeStubBuilder();

    up(pgm);

    expect(pgm.createTable).toHaveBeenCalledTimes(1);
    const [table, columns] = pgm.createTable.mock.calls[0];
    expect(table).toBe('app_settings');
    expect(columns.key).toMatchObject({ type: 'text', notNull: true, primaryKey: true });
    expect(columns.value).toMatchObject({ type: 'text', notNull: true });
    expect(columns.updated_at).toMatchObject({ type: 'timestamptz', notNull: true });

    // The seed row must exist, otherwise the first /api/version poll falls back
    // to '1' and a later hand-inserted row would read as a version change.
    expect(pgm.sql).toHaveBeenCalledTimes(1);
    const seed = pgm.sql.mock.calls[0][0];
    expect(seed).toContain('INSERT INTO app_settings');
    expect(seed).toContain("'client_version'");
  });

  it('drops the table on rollback', () => {
    const pgm = makeStubBuilder();

    down(pgm);

    expect(pgm.dropTable).toHaveBeenCalledWith('app_settings');
  });
});
