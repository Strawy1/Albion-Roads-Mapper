import { API_BASE_URL } from './api';
import { track } from '@vercel/analytics';

/**
 * API operations for a room. All functions accept the room ID and auth token
 * so they can be called from any component without direct store access.
 */


/**
 * Deletes an orphaned node position (no connections) from the given room.
 */
export async function deleteNode(
  roomId: string,
  token: string,
  zoneId: string,
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/rooms/${roomId}/nodes/${zoneId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? 'Failed to delete node');
  }

  track('delete_node');
}

/**
 * Deletes a connection by ID from the given room.
 */
export async function deleteConnection(
  roomId: string,
  token: string,
  connectionId: string,
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/rooms/${roomId}/connections/${connectionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? 'Failed to delete connection');
  }

  track('delete_connection');
}

/**
 * Updates a connection's expiration time.
 */
export async function updateConnection(
  roomId: string,
  token: string,
  connectionId: string,
  update: { secondsRemaining?: number; fromHandleId?: string; toHandleId?: string },
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/rooms/${roomId}/connections/${connectionId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(update),
  });

  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? 'Failed to update connection');
  }

  track('update_connection');
}

/**
 * Adds a connection to the given room.
 */
export async function addConnection(
  roomId: string,
  token: string,
  fromZoneId: string,
  toZoneId: string,
  secondsRemaining: number | null,
  slots: 7 | 20 | null,
  fromHandleId?: string,
  toHandleId?: string,
  reportedBy?: string,
  targetPosition?: { x: number, y: number },
  permanent?: boolean,
): Promise<void> {
  const body: Record<string, unknown> = {
    fromZoneId,
    toZoneId,
    fromHandleId,
    toHandleId,
    reportedBy,
    targetPosition,
  };

  if (permanent) {
    body.permanent = true;
  } else {
    body.secondsRemaining = secondsRemaining;
    body.slots = slots;
  }

  const res = await fetch(`${API_BASE_URL}/api/rooms/${roomId}/connections`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? 'Failed to add connection');
  }

  track('add_connection');
}
