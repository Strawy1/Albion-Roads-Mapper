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

  it('exposes active, inactive and total room gauges', async () => {
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;
    expect(body).toContain('albionmapper_rooms_active');
    expect(body).toContain('albionmapper_rooms_inactive');
    expect(body).toContain('albionmapper_rooms_total');
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

  it('outputs valid Prometheus exposition format (HELP, TYPE, value for each metric)', async () => {
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    const lines = res.body.split('\n').filter((l) => l.trim() !== '');
    // Every non-comment line should be a metric value line: "name value"
    const valueLines = lines.filter((l) => !l.startsWith('#'));
    for (const line of valueLines) {
      expect(line).toMatch(/^albionmapper_\w+ \d+$/);
    }
  });

  it('defaults all values to 0 when DB returns no rows', async () => {
    // mockDb already returns { rows: [] } by default in setupTestApp
    const res = await ctx.app!.inject({ method: 'GET', url: '/metrics' });
    const valueLines = res.body
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.startsWith('#'));
    for (const line of valueLines) {
      expect(line).toMatch(/^albionmapper_\w+ 0$/);
    }
  });
});
