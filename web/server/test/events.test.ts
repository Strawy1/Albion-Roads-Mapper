import { describe, it, expect } from 'vitest';
import { setupTestApp } from './testApp.js';

describe('POST /api/events', () => {
  const ctx = setupTestApp();

  it('accepts a valid event type and increments its daily counter', async () => {
    const res = await ctx.app!.inject({
      method: 'POST',
      url: '/api/events',
      payload: { type: 'donation_modal_shown' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const call = ctx.mockDb.query.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO analytics_events'),
    );
    expect(call).toBeDefined();
    // Upsert on (event_type, date) so repeated events increment the day bucket.
    expect(call[0]).toContain('ON CONFLICT (event_type, date) DO UPDATE SET count = analytics_events.count + 1');
    expect(call[1][0]).toBe('donation_modal_shown');
    // Second param is the Europe/London day bucket (YYYY-MM-DD).
    expect(call[1][1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('requires no authentication', async () => {
    // No Authorization header on purpose — events also fire in locked rooms,
    // where an authenticated mutating request would be rejected.
    const res = await ctx.app!.inject({
      method: 'POST',
      url: '/api/events',
      payload: { type: 'donation_planner_clicked' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects event types with invalid characters', async () => {
    for (const type of ['Donation-Modal', 'has space', 'UPPER', 'semi;colon', 'dash-slug']) {
      const res = await ctx.app!.inject({ method: 'POST', url: '/api/events', payload: { type } });
      expect(res.statusCode).toBe(400);
    }
    expect(
      ctx.mockDb.query.mock.calls.find((c: any[]) => typeof c[0] === 'string' && c[0].includes('analytics_events')),
    ).toBeUndefined();
  });

  it('rejects an empty or missing event type', async () => {
    const empty = await ctx.app!.inject({ method: 'POST', url: '/api/events', payload: { type: '' } });
    expect(empty.statusCode).toBe(400);
    const missing = await ctx.app!.inject({ method: 'POST', url: '/api/events', payload: {} });
    expect(missing.statusCode).toBe(400);
  });

  it('rejects an event type longer than 64 characters', async () => {
    const res = await ctx.app!.inject({
      method: 'POST',
      url: '/api/events',
      payload: { type: 'a'.repeat(65) },
    });
    expect(res.statusCode).toBe(400);
  });
});
