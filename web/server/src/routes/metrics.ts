import type { FastifyInstance } from 'fastify';
import { getTotalSocketCount, getAllRoomSockets } from '../broadcast.js';

/**
 * Formats a single Prometheus metric block (HELP + TYPE + value line).
 */
function metric(name: string, help: string, type: 'gauge' | 'counter', value: number): string {
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}\n`;
}

function isInCidr10(ip: string): boolean {
  // Allow 10.0.0.0/8 (10.x.x.x)
  const parts = ip.split('.');
  return parts.length === 4 && parts[0] === '10';
}

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (request, reply) => {
    const ip = request.ip;
    if (!isInCidr10(ip)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    // --- Live in-process stats ---
    const totalConnections = getTotalSocketCount();
    const roomSockets = getAllRoomSockets();
    const activeRooms = roomSockets.size;

    // --- DB stats ---
    const { rows: roomRows } = await app.db.query<{ total: string; inactive: string }>(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) - $1 AS inactive
       FROM rooms`,
      [activeRooms],
    );
    const totalRooms = parseInt(roomRows[0]?.total ?? '0', 10);
    const inactiveRooms = Math.max(0, parseInt(roomRows[0]?.inactive ?? '0', 10));

    // --- Latest hourly connection stats from DB ---
    const { rows: hourlyRows } = await app.db.query<{
      hour: string;
      max_connections: string;
      min_connections: string;
    }>(
      `SELECT hour, max_connections, min_connections
       FROM analytics_hourly_connections
       ORDER BY hour DESC
       LIMIT 1`,
    );
    const lastHourMax = parseInt(hourlyRows[0]?.max_connections ?? '0', 10);
    const lastHourMin = parseInt(hourlyRows[0]?.min_connections ?? '0', 10);

    // --- Today's global daily stats ---
    const today = new Date().toISOString().slice(0, 10);
    const { rows: dailyRows } = await app.db.query<{
      rooms_created: string;
      rooms_modified: string;
      rooms_reset: string;
      rooms_deleted: string;
      memory_wiped_full: string;
      memory_wiped_single: string;
      passwords_rotated: string;
      peak_concurrent: string;
      unique_tokens_active: string;
      zones_added: string;
      non_roads_zones_added: string;
      room_data_updates: string;
      routes_plotted: string;
    }>(
      `SELECT
         rooms_created, rooms_modified, rooms_reset, rooms_deleted,
         memory_wiped_full, memory_wiped_single, passwords_rotated,
         peak_concurrent, unique_tokens_active,
         zones_added, non_roads_zones_added, room_data_updates, routes_plotted
       FROM analytics_global_daily
       WHERE date = $1`,
      [today],
    );
    const daily = dailyRows[0];

    const lines: string[] = [];

    // Live gauges
    lines.push(metric('albionmapper_websocket_connections_active', 'Current number of active WebSocket connections', 'gauge', totalConnections));
    lines.push(metric('albionmapper_rooms_active', 'Number of rooms with at least one active WebSocket connection', 'gauge', activeRooms));
    lines.push(metric('albionmapper_rooms_inactive', 'Number of rooms with no active WebSocket connections', 'gauge', inactiveRooms));
    lines.push(metric('albionmapper_rooms_total', 'Total number of rooms in the database', 'gauge', totalRooms));

    // Last-hour connection stats from analytics_hourly_connections
    lines.push(metric('albionmapper_hourly_connections_max', 'Maximum concurrent WebSocket connections observed in the most recent recorded hour bucket', 'gauge', lastHourMax));
    lines.push(metric('albionmapper_hourly_connections_min', 'Minimum concurrent WebSocket connections observed in the most recent recorded hour bucket', 'gauge', lastHourMin));

    // Today's daily counters
    lines.push(metric('albionmapper_daily_rooms_created_total', 'Rooms created today (UTC)', 'gauge', parseInt(daily?.rooms_created ?? '0', 10)));
    lines.push(metric('albionmapper_daily_rooms_modified_total', 'Rooms with at least one data modification today (UTC)', 'gauge', parseInt(daily?.rooms_modified ?? '0', 10)));
    lines.push(metric('albionmapper_daily_rooms_reset_total', 'Rooms reset today (UTC)', 'gauge', parseInt(daily?.rooms_reset ?? '0', 10)));
    lines.push(metric('albionmapper_daily_rooms_deleted_total', 'Rooms deleted today (UTC)', 'gauge', parseInt(daily?.rooms_deleted ?? '0', 10)));
    lines.push(metric('albionmapper_daily_memory_wiped_full_total', 'Full memory wipes performed today (UTC)', 'gauge', parseInt(daily?.memory_wiped_full ?? '0', 10)));
    lines.push(metric('albionmapper_daily_memory_wiped_single_total', 'Single memory wipes performed today (UTC)', 'gauge', parseInt(daily?.memory_wiped_single ?? '0', 10)));
    lines.push(metric('albionmapper_daily_passwords_rotated_total', 'Password rotations performed today (UTC)', 'gauge', parseInt(daily?.passwords_rotated ?? '0', 10)));
    lines.push(metric('albionmapper_daily_peak_concurrent', 'Peak concurrent WebSocket connections today (UTC)', 'gauge', parseInt(daily?.peak_concurrent ?? '0', 10)));
    lines.push(metric('albionmapper_daily_unique_tokens_active', 'Unique authenticated tokens seen today (UTC)', 'gauge', parseInt(daily?.unique_tokens_active ?? '0', 10)));
    lines.push(metric('albionmapper_daily_zones_added_roads_total', 'Road zones added today (UTC)', 'gauge', parseInt(daily?.zones_added ?? '0', 10)));
    lines.push(metric('albionmapper_daily_zones_added_nonroads_total', 'Non-road zones added today (UTC)', 'gauge', parseInt(daily?.non_roads_zones_added ?? '0', 10)));
    lines.push(metric('albionmapper_daily_room_data_updates_total', 'Total room data update events today (UTC)', 'gauge', parseInt(daily?.room_data_updates ?? '0', 10)));
    lines.push(metric('albionmapper_daily_routes_plotted_total', 'Routes plotted today (UTC)', 'gauge', parseInt(daily?.routes_plotted ?? '0', 10)));

    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(lines.join('\n'));
  });
}
