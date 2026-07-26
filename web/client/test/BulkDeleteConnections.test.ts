import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteConnections } from '../src/utils/roomOperations';

vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));

const ROOM_ID = 'room1';
const TOKEN = 'token1';

describe('deleteConnections (bulk branch delete)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends every id in a single request', async () => {
    const connectionIds = Array.from({ length: 12 }, (_, i) => `conn-${i}`);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ removedConnectionIds: connectionIds, removedZoneIds: ['zone-b'] }),
    } as Response);

    const result = await deleteConnections(ROOM_ID, TOKEN, connectionIds);

    // One HTTP round trip for the whole branch — the point of the endpoint.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/rooms/${ROOM_ID}/connections/bulk-delete`),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ connectionIds }),
      }),
    );
    expect(result).toEqual({ removedConnectionIds: connectionIds, removedZoneIds: ['zone-b'] });
  });

  it('throws with the server error message when the request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Room is locked' }),
    } as Response);

    await expect(deleteConnections(ROOM_ID, TOKEN, ['conn-a'])).rejects.toThrow('Room is locked');
  });
});
