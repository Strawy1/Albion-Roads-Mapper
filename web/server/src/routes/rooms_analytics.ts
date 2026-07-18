import type { Pool } from 'pg';
import {
  incrementGlobal,
  incrementRoomDaily,
  incrementRoomAlltime,
  recalculateRoomCounts,
  recordRouteLastPlotted,
  londonDateString,
} from '../analytics.js';

export function trackRoomCreated(db: Pool): void {
  incrementGlobal(db, { rooms_created: 1 });
}

export function trackPasswordRotated(db: Pool): void {
  incrementGlobal(db, { passwords_rotated: 1 });
}

export function trackRoomReset(db: Pool): void {
  incrementGlobal(db, { rooms_reset: 1 });
}

export function trackMemoryWipedFull(db: Pool): void {
  incrementGlobal(db, { memory_wiped_full: 1 });
}

export function trackMemoryWipedSingle(db: Pool): void {
  incrementGlobal(db, { memory_wiped_single: 1 });
}

export function trackRoomDeleted(db: Pool): void {
  incrementGlobal(db, { rooms_deleted: 1 });
  recalculateRoomCounts(db, londonDateString());
}

export function trackRoomModified(db: Pool, roomId: string): void {
  // room_data_updates counts every individual data modification event, regardless of room.
  incrementGlobal(db, { room_data_updates: 1 });
  incrementRoomDaily(db, roomId, { data_updates: 1 });
  incrementRoomAlltime(db, roomId, { data_updates: 1 });
}

export function trackRoutePlotted(db: Pool, roomId: string): void {
  incrementGlobal(db, { routes_plotted: 1, room_data_updates: 1 });
  incrementRoomDaily(db, roomId, { routes_plotted: 1 });
  incrementRoomAlltime(db, roomId, { routes_plotted: 1 });
  recordRouteLastPlotted(db, roomId);
}

export function trackTokenIssued(db: Pool, roomId: string): void {
  incrementGlobal(db, { tokens_issued: 1 });
  incrementRoomDaily(db, roomId, { tokens_issued: 1 });
  incrementRoomAlltime(db, roomId, { tokens_issued: 1 });
}

/**
 * Tracks a newly discovered zone for a room, split by roads vs non-roads.
 * @param isRoads - true when the zone type is 'roads' or 'roadsHideout'
 */
export function trackZoneAdded(db: Pool, roomId: string, isRoads: boolean): void {
  if (isRoads) {
    incrementGlobal(db, { zones_added: 1, room_data_updates: 1 });
    incrementRoomDaily(db, roomId, { zones_added_roads: 1 });
    incrementRoomAlltime(db, roomId, { zones_added_roads: 1 });
  } else {
    incrementGlobal(db, { non_roads_zones_added: 1, room_data_updates: 1 });
    incrementRoomDaily(db, roomId, { zones_added_nonroads: 1 });
    incrementRoomAlltime(db, roomId, { zones_added_nonroads: 1 });
  }
}
