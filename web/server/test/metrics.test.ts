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

  it('reports a live count and per-room series for currently plotted routes', async () => {
    ctx.mockDb.query.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('plotted_route')) {
        // Live state comes from the rooms table, not the analytics day buckets,
        // must ignore cleared (NULL/empty) routes, and must only count routes
        // whose snapshotted expiry is still in the future.
        expect(sql).toContain('FROM rooms');
        expect(sql).toContain("COALESCE(array_length(plotted_route, 1), 0) > 0");
        expect(sql).toContain('plotted_route_expires_at > NOW()');
        return { rows: [{ room_id: 'room-a' }, { room_id: 'room-b' }] };
      }
      return { rows: [] };
    });
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toContain('# HELP albionmapper_rooms_route_plotted Number of rooms with a currently plotted route');
    expect(res.body).toMatch(/albionmapper_rooms_route_plotted 2\b/);
    expect(res.body).toContain('albionmapper_room_route_plotted{room_id="room-a"} 1');
    expect(res.body).toContain('albionmapper_room_route_plotted{room_id="room-b"} 1');
  });

  it('reports zero rooms with plotted routes and omits the per-room series when none exist', async () => {
    // Default mock returns { rows: [] } for every query.
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toMatch(/albionmapper_rooms_route_plotted 0\b/);
    expect(res.body).not.toContain('albionmapper_room_route_plotted{');
  });

  it('exposes all-time and last-plotted route gauges, defaulting to 0', async () => {
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toContain('# HELP albionmapper_routes_plotted_total Total number of routes plotted across all rooms since tracking began');
    expect(res.body).toContain('# TYPE albionmapper_routes_plotted_total counter');
    expect(res.body).toMatch(/albionmapper_routes_plotted_total 0\b/);
    expect(res.body).toContain('# HELP albionmapper_routes_last_plotted Unix epoch seconds of the last time any route was plotted');
    expect(res.body).toMatch(/albionmapper_routes_last_plotted 0\b/);
  });

  it('reports per-room all-time routes plotted and last-plotted time', async () => {
    ctx.mockDb.query.mockImplementation(async (sql: string) => {
      if (typeof sql !== 'string') return { rows: [] };
      if (sql.includes('routes_last_plotted_at') && sql.includes('analytics_global_alltime')) {
        // Global last-plotted: exact timestamp preferred, daily-bucket fallback via GREATEST.
        expect(sql).toContain('GREATEST');
        return { rows: [{ last_epoch: '1784644325' }] };
      }
      if (sql.includes('routes_last_plotted_at')) {
        // Per-room last-plotted: same exact-with-fallback shape.
        expect(sql).toContain('GREATEST');
        return { rows: [{ room_id: 'room-a', last_plotted: '2026-07-17T14:32:05', last_epoch: '1784644325' }] };
      }
      if (sql.includes('FROM analytics_room_alltime')) {
        return { rows: [{ room_id: 'room-a', tokens_issued: '0', data_updates: '0', routes_plotted: '7' }] };
      }
      return { rows: [] };
    });
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toContain('# TYPE albionmapper_room_routes_plotted_alltime counter');
    expect(res.body).toContain('albionmapper_room_routes_plotted_alltime{room_id="room-a"} 7');
    expect(res.body).toContain('albionmapper_room_routes_last_plotted{room_id="room-a",last_plotted="2026-07-17T14:32:05"} 1784644325');
    expect(res.body).toMatch(/albionmapper_routes_last_plotted 1784644325\b/);
  });

  it('omits per-room route series when no routes were ever plotted', async () => {
    // Default mock returns { rows: [] } for every query.
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).not.toContain('albionmapper_room_routes_plotted_alltime{');
    expect(res.body).not.toContain('albionmapper_room_routes_last_plotted{');
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

  it('exposes all-time room lifecycle totals summed across day buckets', async () => {
    ctx.mockDb.query.mockImplementation(async (sql: string) => {
      if (typeof sql !== 'string') return { rows: [] };
      if (sql.includes('SUM(rooms_reset)') && sql.includes('FROM analytics_global_daily')) {
        return { rows: [{
          tokens_issued: '0', room_data_updates: '0', routes_plotted: '0',
          rooms_created: '42', rooms_modified: '30', rooms_reset: '7', rooms_deleted: '9',
        }] };
      }
      return { rows: [] };
    });
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;
    expect(body).toContain('# TYPE albionmapper_rooms_reset_total counter');
    expect(body).toMatch(/albionmapper_rooms_created_total 42\b/);
    expect(body).toMatch(/albionmapper_rooms_modified_total 30\b/);
    expect(body).toMatch(/albionmapper_rooms_reset_total 7\b/);
    expect(body).toMatch(/albionmapper_rooms_deleted_total 9\b/);
  });

  it('defaults all-time room lifecycle totals to 0 when no data exists', async () => {
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toMatch(/albionmapper_rooms_reset_total 0\b/);
    expect(res.body).toMatch(/albionmapper_rooms_created_total 0\b/);
  });

  it('exposes Map History stats', async () => {
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;
    expect(body).toContain('albionmapper_history_entries_total');
    // labeled metrics only show up if there is data, but since we default to 0/empty it might not be there
    // However, the base gauge should exist
  });

  it('exposes labeled all-time and today series for generic client events', async () => {
    ctx.mockDb.query.mockImplementation(async (sql: string) => {
      if (typeof sql !== 'string' || !sql.includes('FROM analytics_events')) return { rows: [] };
      if (sql.includes('SUM(count)')) {
        // All-time totals are summed across day buckets.
        return { rows: [{ event_type: 'donation_modal_shown', total: '12' }, { event_type: 'donation_modal_clicked', total: '4' }] };
      }
      // Today's bucket is filtered by the Europe/London date param.
      expect(sql).toContain('WHERE date = $1');
      return { rows: [{ event_type: 'donation_modal_shown', count: '2' }] };
    });
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toContain('# TYPE albionmapper_events_total counter');
    expect(res.body).toContain('albionmapper_events_total{event="donation_modal_shown"} 12');
    expect(res.body).toContain('albionmapper_events_total{event="donation_modal_clicked"} 4');
    expect(res.body).toContain('# TYPE albionmapper_events_today gauge');
    expect(res.body).toContain('albionmapper_events_today{event="donation_modal_shown"} 2');
  });

  it('omits event series when no events have been recorded', async () => {
    // Default mock returns { rows: [] } for every query.
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).not.toContain('albionmapper_events_total{');
    expect(res.body).not.toContain('albionmapper_events_today{');
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
