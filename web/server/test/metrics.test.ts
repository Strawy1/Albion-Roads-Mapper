import { describe, it, expect } from 'vitest';
import { setupTestApp } from './testApp.js';

describe('GET /metrics', () => {
  const ctx = setupTestApp();

  it('returns 200 with Prometheus text content-type', async () => {
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
  });

  it('exposes live websocket connection gauge', async () => {
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;
    expect(body).toContain('# HELP albionmapper_websocket_connections_active');
    expect(body).toContain('# TYPE albionmapper_websocket_connections_active gauge');
    expect(body).toMatch(/albionmapper_websocket_connections_active \d+/);
  });

  it('exposes active, inactive, total, expired, empty and locked room gauges', async () => {
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;
    expect(body).toContain('albionmapper_rooms_active');
    expect(body).toContain('albionmapper_rooms_inactive');
    expect(body).toContain('albionmapper_rooms_total');
    expect(body).toContain('albionmapper_rooms_expired');
    expect(body).toContain('albionmapper_rooms_empty');
    expect(body).toContain('albionmapper_rooms_locked');
  });

  it('reports the locked-rooms count from the rooms aggregate query', async () => {
    // First DB query in the metrics handler is the rooms aggregate.
    ctx.mockDb.query.mockResolvedValueOnce({
      rows: [{ total: '5', inactive: '1', empty: '0', expired: '0', active: '4', locked: '3' }],
    });
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toContain('# HELP albionmapper_rooms_locked Number of rooms currently locked (read-only for non-admins)');
    expect(res.body).toContain('# TYPE albionmapper_rooms_locked gauge');
    expect(res.body).toMatch(/albionmapper_rooms_locked 3\b/);
    // The aggregate SQL must count locked rooms.
    const call = ctx.mockDb.query.mock.calls.find((c: any[]) => typeof c[0] === 'string' && c[0].includes('FROM rooms') && c[0].includes('AS locked'));
    expect(call[0]).toContain('FILTER (WHERE locked)');
  });

  it('lists locked rooms by room ID', async () => {
    // Query order: rooms aggregate first, then the locked-rooms-by-ID query.
    ctx.mockDb.query
      .mockResolvedValueOnce({
        rows: [{ total: '5', inactive: '1', empty: '0', expired: '0', active: '4', locked: '2' }],
      })
      .mockResolvedValueOnce({ rows: [{ room_id: 'room-a' }, { room_id: 'room-b' }] });
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toContain('# HELP albionmapper_room_locked Rooms currently locked (read-only for non-admins), one series per locked room ID');
    expect(res.body).toContain('# TYPE albionmapper_room_locked gauge');
    expect(res.body).toContain('albionmapper_room_locked{room_id="room-a"} 1');
    expect(res.body).toContain('albionmapper_room_locked{room_id="room-b"} 1');
  });

  it('omits the per-room locked series when no rooms are locked', async () => {
    // Default mock returns { rows: [] } for every query.
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).not.toContain('albionmapper_room_locked{');
  });

  it('exposes the total chains gauge, defaulting to 0', async () => {
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toContain('# HELP albionmapper_chains_total Total number of chains across rooms that use chains');
    expect(res.body).toContain('# TYPE albionmapper_chains_total gauge');
    expect(res.body).toMatch(/albionmapper_chains_total 0\b/);
  });

  it('reports per-room chain counts, skipping rooms with only the default primary chain', async () => {
    ctx.mockDb.query.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('FROM room_chains')) {
        // Rooms with a single (default primary) chain must be filtered out in SQL.
        expect(sql).toContain('HAVING COUNT(*) > 1');
        return { rows: [{ room_id: 'room-a', chain_count: '3' }, { room_id: 'room-b', chain_count: '2' }] };
      }
      return { rows: [] };
    });
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toContain('# HELP albionmapper_room_chains_total Number of chains per room; rooms with only the default primary chain are omitted');
    expect(res.body).toContain('# TYPE albionmapper_room_chains_total gauge');
    expect(res.body).toContain('albionmapper_room_chains_total{room_id="room-a"} 3');
    expect(res.body).toContain('albionmapper_room_chains_total{room_id="room-b"} 2');
    expect(res.body).toMatch(/albionmapper_chains_total 5\b/);
  });

  it('omits the per-room chains series when no rooms have more than one chain', async () => {
    // Default mock returns { rows: [] } for every query.
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).not.toContain('albionmapper_room_chains_total{');
  });

  it('exposes hourly connection max and min gauges', async () => {
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;
    expect(body).toContain('albionmapper_hourly_connections_max');
    expect(body).toContain('albionmapper_hourly_connections_min');
  });

  it('exposes all daily global stat gauges', async () => {
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;
    const expectedMetrics = [
      'albionmapper_daily_rooms_created_total',
      'albionmapper_daily_rooms_modified_total',
      'albionmapper_daily_rooms_reset_total',
      'albionmapper_daily_rooms_deleted_total',
      'albionmapper_daily_rooms_aborted_total',
      'albionmapper_daily_rooms_abandoned_total',
      'albionmapper_daily_memory_wiped_full_total',
      'albionmapper_daily_memory_wiped_single_total',
      'albionmapper_daily_passwords_rotated_total',
      'albionmapper_daily_peak_concurrent',
      'albionmapper_daily_unique_tokens_active',
      'albionmapper_daily_zones_added_roads_total',
      'albionmapper_daily_zones_added_nonroads_total',
      'albionmapper_daily_room_data_updates_total',
      'albionmapper_daily_routes_plotted_total',
    ];
    for (const name of expectedMetrics) {
      expect(body).toContain(name);
    }
  });

  it('exposes Map History stats', async () => {
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;
    expect(body).toContain('albionmapper_history_entries_total');
    // labeled metrics only show up if there is data, but since we default to 0/empty it might not be there
    // However, the base gauge should exist
  });

  it('outputs valid Prometheus exposition format (HELP, TYPE, value for each metric)', async () => {
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    const lines = res.body.split('\n').filter((l) => l.trim() !== '');
    // Every non-comment line should be a metric value line: "name value"
    const valueLines = lines.filter((l) => !l.startsWith('#'));
    for (const line of valueLines) {
      // Allow for labeled metrics: name{label="value"} 123
      expect(line).toMatch(/^albionmapper_[\w_]+(\{.*?\})? \d+$/);
    }
  });

  it('defaults all values to 0 when DB returns no rows', async () => {
    // mockDb already returns { rows: [] } by default in setupTestApp
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    const valueLines = res.body
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.startsWith('#'));
    for (const line of valueLines) {
      expect(line).toMatch(/^albionmapper_[\w_]+(\{.*?\})? 0$/);
    }
  });

  it('contains correct HELP text for active and expired rooms', async () => {
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;
    expect(body).toContain('# HELP albionmapper_rooms_active Number of rooms with at least one non-expired connection');
    expect(body).toContain('# HELP albionmapper_rooms_expired Number of rooms where all connections have expired');
  });

  it('contains correct HELP text for Map History stats', async () => {
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;
    expect(body).toContain('# HELP albionmapper_history_entries_total Total number of unique room-map history entries (excluding home zones)');
  });
});
