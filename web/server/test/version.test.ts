import { expect, test } from 'vitest';
import { setupTestApp } from './testApp.js';

const context = setupTestApp();

test('GET /api/version returns the stored client_version token', async () => {
  context.mockDb.query.mockResolvedValueOnce({ rows: [{ value: '7' }] });

  const response = await context.app!.inject({ method: 'GET', url: '/api/version' });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ version: '7' });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(context.mockDb.query).toHaveBeenCalledWith(
    "SELECT value FROM app_settings WHERE key = 'client_version'"
  );
});

test('GET /api/version falls back to "1" when the row is missing', async () => {
  context.mockDb.query.mockResolvedValueOnce({ rows: [] });

  const response = await context.app!.inject({ method: 'GET', url: '/api/version' });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ version: '1' });
});

test('GET /api/version requires no authentication', async () => {
  // No Authorization header on purpose — the poll has to work for users who are
  // not in a room at all (they hold no token and no WebSocket).
  context.mockDb.query.mockResolvedValueOnce({ rows: [{ value: '3' }] });

  const response = await context.app!.inject({ method: 'GET', url: '/api/version' });

  expect(response.statusCode).toBe(200);
});
