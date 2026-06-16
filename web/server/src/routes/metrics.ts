import type { FastifyInstance } from 'fastify';
import { londonDateString } from '../analytics.js';
import { getTotalSocketCount, getAllRoomSockets } from '../broadcast.js';

/**
 * Formats a single Prometheus metric block (HELP + TYPE + value line).
 */
function metric(name: string, help: string, type: 'gauge' | 'counter', value: number): string {
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}\n`;
}

/**
 * Formats a Prometheus metric block with multiple labeled series.
 */
function metricLabeled(name: string, help: string, type: 'gauge' | 'counter', series: { labels: Record<string, string>; value: number }[]): string {
  const labelStr = (labels: Record<string, string>) =>
    Object.entries(labels)
      .map(([k, v]) => `${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
      .join(',');
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`];
  for (const s of series) {
    lines.push(`${name}{${labelStr(s.labels)}} ${s.value}`);
  }
  return lines.join('\n') + '\n';
}

function isAllowedMetricsIp(ip: string): boolean {
  // Allow localhost and 10.0.1.0/24; Cloudflare tunnel on 10.0.5.0/24 is blocked
  if (ip === '127.0.0.1' || ip === '::1') return true;
  const parts = ip.split('.');
  return parts.length === 4 && parts[0] === '10' && parts[1] === '0' && parts[2] === '1';
}

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (request, reply) => {
    const ip = request.ip;
    if (!isAllowedMetricsIp(ip)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    // --- Live in-process stats ---
    const totalConnections = getTotalSocketCount();
    const roomSockets = getAllRoomSockets();
    const liveRooms = roomSockets.size;

    // --- DB stats ---
    const { rows: roomRows } = await app.db.query<{ total: string; inactive: string; empty: string; expired: string; active: string }>(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) - $1 AS inactive,
         COUNT(*) FILTER (WHERE id NOT IN (SELECT DISTINCT room_id FROM connections)) AS empty,
         COUNT(*) FILTER (WHERE id IN (SELECT DISTINCT room_id FROM connections) AND id NOT IN (SELECT DISTINCT room_id FROM connections WHERE expires_at > NOW())) AS expired,
         COUNT(*) FILTER (WHERE id IN (SELECT DISTINCT room_id FROM connections WHERE expires_at > NOW())) AS active
       FROM rooms`,
      [liveRooms],
    );
    const totalRooms = parseInt(roomRows[0]?.total ?? '0', 10);
    const inactiveRooms = Math.max(0, parseInt(roomRows[0]?.inactive ?? '0', 10));
    const emptyRooms = parseInt(roomRows[0]?.empty ?? '0', 10);
    const expiredRooms = parseInt(roomRows[0]?.expired ?? '0', 10);
    const activeRooms = parseInt(roomRows[0]?.active ?? '0', 10);

    // --- Latest hourly connection stats from DB ---
    // avg_connections is the mean of all per-minute scrape samples recorded in that hour bucket
    const { rows: hourlyRows } = await app.db.query<{
      hour: string;
      max_connections: string;
      min_connections: string;
      avg_connections: string;
    }>(
      `SELECT hour, max_connections, min_connections, avg_connections
       FROM analytics_hourly_connections
       ORDER BY hour DESC
       LIMIT 1`,
    );
    const lastHourMax = parseInt(hourlyRows[0]?.max_connections ?? '0', 10);
    const lastHourMin = parseInt(hourlyRows[0]?.min_connections ?? '0', 10);
    const lastHourAvg = parseFloat(hourlyRows[0]?.avg_connections ?? '0');

    // --- All hourly buckets for hour-of-day activity chart ---
    // Returns one row per hour bucket recorded, used to build a labelled series
    // so Grafana can aggregate by Europe/London hour across multiple days.
    // We aggregate by the hour component (0-23) across all days to produce a single series.
    const { rows: allHourlyRows } = await app.db.query<{
      hour_of_day: number;
      avg_connections: string;
    }>(
      `SELECT EXTRACT(HOUR FROM hour) AS hour_of_day,
              SUM(avg_connections * sample_count) / NULLIF(SUM(sample_count), 0) AS avg_connections
       FROM analytics_hourly_connections
       GROUP BY hour_of_day
       ORDER BY hour_of_day ASC`,
    );

    // Today's global daily stats (Europe/London) ---
    const today = londonDateString();
    const { rows: dailyRows } = await app.db.query<{
      rooms_created: string;
      rooms_modified: string;
      rooms_reset: string;
      rooms_deleted: string;
      rooms_aborted: string;
      rooms_abandoned: string;
      memory_wiped_full: string;
      memory_wiped_single: string;
      passwords_rotated: string;
      peak_concurrent: string;
      unique_tokens_active: string;
      zones_added: string;
      non_roads_zones_added: string;
      room_data_updates: string;
      routes_plotted: string;
      tokens_issued: string;
    }>(
      `SELECT
         rooms_created, rooms_modified, rooms_reset, rooms_deleted,
         rooms_aborted, rooms_abandoned,
         memory_wiped_full, memory_wiped_single, passwords_rotated,
         peak_concurrent, unique_tokens_active,
         zones_added, non_roads_zones_added, room_data_updates, routes_plotted, tokens_issued
       FROM analytics_global_daily
       WHERE date = $1`,
      [today],
    );
    const daily = dailyRows[0];

    // --- All-time cumulative stats ---
    const { rows: alltimeRows } = await app.db.query<{
      alltime_peak: string;
      alltime_avg: string;
    }>(
      `SELECT
         COALESCE(MAX(max_connections), 0) AS alltime_peak,
         COALESCE(
           SUM(avg_connections * sample_count) / NULLIF(SUM(sample_count), 0),
           0
         ) AS alltime_avg
       FROM analytics_hourly_connections`
    );
    const alltimePeak = parseInt(alltimeRows[0]?.alltime_peak ?? '0', 10);
    const alltimeAvg = parseFloat(alltimeRows[0]?.alltime_avg ?? '0');

    const { rows: alltimeGlobalRows } = await app.db.query<{ tokens_issued: string }>(
      'SELECT SUM(tokens_issued) AS tokens_issued FROM analytics_global_daily',
    );
    const totalTokensIssued = parseInt(alltimeGlobalRows[0]?.tokens_issued ?? '0', 10);

    // --- All-time room cleanup stats ---
    const { rows: cleanupAlltimeRows } = await app.db.query<{
      rooms_aborted: string;
      rooms_abandoned: string;
    }>('SELECT rooms_aborted, rooms_abandoned FROM analytics_global_alltime WHERE id = 1');
    const totalRoomsAborted  = parseInt(cleanupAlltimeRows[0]?.rooms_aborted  ?? '0', 10);
    const totalRoomsAbandoned = parseInt(cleanupAlltimeRows[0]?.rooms_abandoned ?? '0', 10);

    const { rows: alltimeRoomRows } = await app.db.query<{ room_id: string; tokens_issued: string }>(
      'SELECT room_id, tokens_issued FROM analytics_room_alltime WHERE tokens_issued > 0',
    );

    // --- Map History stats ---
    const { rows: mapHistoryRows } = await app.db.query<{ zone_id: string; total_mentions: string }>(
      `SELECT rnm.zone_id, COUNT(DISTINCT rnm.room_id) AS total_mentions
       FROM room_node_memory rnm
       JOIN rooms r ON r.id = rnm.room_id
       WHERE rnm.zone_id != r.home_zone_id
       GROUP BY rnm.zone_id`
    );

    const { rows: roomHistoryRows } = await app.db.query<{ room_id: string; total_entries: string }>(
      `SELECT rnm.room_id, COUNT(DISTINCT rnm.zone_id) AS total_entries
       FROM room_node_memory rnm
       JOIN rooms r ON r.id = rnm.room_id
       WHERE rnm.zone_id != r.home_zone_id
       GROUP BY rnm.room_id`
    );

    const { rows: totalHistoryRows } = await app.db.query<{ total: string }>(
      `SELECT COUNT(*) AS total
       FROM room_node_memory rnm
       JOIN rooms r ON r.id = rnm.room_id
       WHERE rnm.zone_id != r.home_zone_id`
    );
    const totalHistoryEntries = parseInt(totalHistoryRows[0]?.total ?? '0', 10);

    const lines: string[] = [];

    // --- Live rooms (rooms with active WebSocket connections right now) ---
    lines.push(metric('albionmapper_websocket_connections_active', 'Current number of active WebSocket connections', 'gauge', totalConnections));

    // Per-room live connection counts
    const roomSeries = Array.from(roomSockets.entries()).map(([roomId, sockets]) => ({
      labels: { room_id: roomId },
      value: sockets.size,
    }));
    if (roomSeries.length > 0) {
      lines.push(metricLabeled('albionmapper_room_connections', 'Number of active WebSocket connections per room', 'gauge', roomSeries));
    }

    // --- Zone counts (excluding home zone) ---
    const { rows: zoneCountRows } = await app.db.query<{ total_zones: string }>(
      `SELECT COUNT(*) AS total_zones
       FROM room_node_positions rnp
       JOIN rooms r ON r.id = rnp.room_id
       WHERE rnp.zone_id != r.home_zone_id`,
    );
    const totalZones = parseInt(zoneCountRows[0]?.total_zones ?? '0', 10);

    const { rows: perRoomZoneRows } = await app.db.query<{ room_id: string; zone_count: string }>(
      `SELECT rnp.room_id, COUNT(*) AS zone_count
       FROM room_node_positions rnp
       JOIN rooms r ON r.id = rnp.room_id
       WHERE rnp.zone_id != r.home_zone_id
       GROUP BY rnp.room_id`,
    );

    // --- Active rooms (DB-level room state) ---
    lines.push(metric('albionmapper_rooms_total', 'Total number of rooms in the database', 'gauge', totalRooms));
    lines.push(metric('albionmapper_rooms_live', 'Number of rooms with at least one active WebSocket connection (live now)', 'gauge', liveRooms));
    lines.push(metric('albionmapper_rooms_active', 'Number of rooms with at least one non-expired connection', 'gauge', activeRooms));
    lines.push(metric('albionmapper_rooms_inactive', 'Number of rooms with no active WebSocket connections', 'gauge', inactiveRooms));
    lines.push(metric('albionmapper_rooms_empty', 'Number of rooms with no connections added', 'gauge', emptyRooms));
    lines.push(metric('albionmapper_rooms_expired', 'Number of rooms where all connections have expired', 'gauge', expiredRooms));

    // --- Zone counts ---
    lines.push(metric('albionmapper_zones_total', 'Total number of zones entered into the system (excluding home zones)', 'gauge', totalZones));
    const perRoomZoneSeries = perRoomZoneRows
      .map(r => ({ labels: { room_id: r.room_id }, value: parseInt(r.zone_count ?? '0', 10) }))
      .filter(s => s.value > 0);
    if (perRoomZoneSeries.length > 0) {
      lines.push(metricLabeled('albionmapper_room_zones_total', 'Total number of zones entered per room (excluding home zone)', 'gauge', perRoomZoneSeries));
    }

    // --- Hourly connection stats ---
    // Last completed hour bucket
    lines.push(metric('albionmapper_hourly_connections_max', 'Maximum concurrent WebSocket connections observed in the most recent recorded hour bucket', 'gauge', lastHourMax));
    lines.push(metric('albionmapper_hourly_connections_min', 'Minimum concurrent WebSocket connections observed in the most recent recorded hour bucket', 'gauge', lastHourMin));
    lines.push(metric('albionmapper_hourly_connections_avg', 'Average concurrent WebSocket connections observed in the most recent recorded hour bucket', 'gauge', lastHourAvg));

    // All-time records
    lines.push(metric('albionmapper_alltime_peak_concurrent', 'All-time peak concurrent WebSocket connections since tracking began', 'gauge', alltimePeak));
    lines.push(metric('albionmapper_alltime_avg_concurrent', 'All-time sample-weighted average concurrent WebSocket connections since tracking began', 'gauge', alltimeAvg));

    // All hourly buckets as labelled series for hour-of-day activity chart.
    // Label is the Europe/London hour (0–23) so Grafana can avg across multiple days.
    const hourlySeries = allHourlyRows.map(r => ({
      labels: { hour: r.hour_of_day.toString().padStart(2, '0') },
      value: parseFloat(r.avg_connections ?? '0'),
    }));
    if (hourlySeries.length > 0) {
      lines.push(metricLabeled('albionmapper_hourly_connections_avg_by_hour', 'Average concurrent WebSocket connections per Europe/London hour of day', 'gauge', hourlySeries));
    }

    // --- Global cumulative stats ---
    lines.push(metric('albionmapper_tokens_issued_total', 'Total number of authenticated tokens issued since tracking began', 'gauge', totalTokensIssued));

    // Per-room cumulative stats
    const roomTokensIssuedSeries = alltimeRoomRows.map(r => ({
      labels: { room_id: r.room_id },
      value: parseInt(r.tokens_issued ?? '0', 10),
    }));
    if (roomTokensIssuedSeries.length > 0) {
      lines.push(metricLabeled('albionmapper_room_tokens_issued_total', 'Total number of authenticated tokens issued per room', 'gauge', roomTokensIssuedSeries));
    }

    // Per-room daily stats for today
    const { rows: roomDailyRows } = await app.db.query<{
      room_id: string;
      routes_plotted: string;
      data_updates: string;
      zones_added_roads: string;
      zones_added_nonroads: string;
      tokens_issued: string;
    }>(
      `SELECT room_id, routes_plotted, data_updates, zones_added_roads, zones_added_nonroads, tokens_issued
       FROM analytics_room_daily
       WHERE date = $1`,
      [today],
    );
    if (roomDailyRows.length > 0) {
      const routesSeries = roomDailyRows.map(r => ({ labels: { room_id: r.room_id }, value: parseInt(r.routes_plotted ?? '0', 10) })).filter(s => s.value > 0);
      if (routesSeries.length > 0) lines.push(metricLabeled('albionmapper_room_routes_plotted_today', 'Routes plotted today (Europe/London) per room', 'gauge', routesSeries));
      const dataUpdatesSeries = roomDailyRows.map(r => ({ labels: { room_id: r.room_id }, value: parseInt(r.data_updates ?? '0', 10) })).filter(s => s.value > 0);
      if (dataUpdatesSeries.length > 0) lines.push(metricLabeled('albionmapper_room_data_updates_today', 'Room data update events today (Europe/London) per room', 'gauge', dataUpdatesSeries));
      const zonesRoadsSeries = roomDailyRows.map(r => ({ labels: { room_id: r.room_id }, value: parseInt(r.zones_added_roads ?? '0', 10) })).filter(s => s.value > 0);
      if (zonesRoadsSeries.length > 0) lines.push(metricLabeled('albionmapper_room_zones_added_roads_today', 'Road zones added today (Europe/London) per room', 'gauge', zonesRoadsSeries));
      const zonesNonroadsSeries = roomDailyRows.map(r => ({ labels: { room_id: r.room_id }, value: parseInt(r.zones_added_nonroads ?? '0', 10) })).filter(s => s.value > 0);
      if (zonesNonroadsSeries.length > 0) lines.push(metricLabeled('albionmapper_room_zones_added_nonroads_today', 'Non-road zones added today (Europe/London) per room', 'gauge', zonesNonroadsSeries));
      const tokensIssuedSeries = roomDailyRows.map(r => ({ labels: { room_id: r.room_id }, value: parseInt(r.tokens_issued ?? '0', 10) })).filter(s => s.value > 0);
      if (tokensIssuedSeries.length > 0) lines.push(metricLabeled('albionmapper_room_tokens_issued_today', 'Tokens issued today (Europe/London) per room', 'gauge', tokensIssuedSeries));
    }

    // Today's daily counters
    lines.push(metric('albionmapper_daily_rooms_created_total', 'Rooms created today (Europe/London)', 'gauge', parseInt(daily?.rooms_created ?? '0', 10)));
    lines.push(metric('albionmapper_daily_rooms_modified_total', 'Rooms with at least one data modification today (Europe/London)', 'gauge', parseInt(daily?.rooms_modified ?? '0', 10)));
    lines.push(metric('albionmapper_daily_rooms_reset_total', 'Rooms reset today (Europe/London)', 'gauge', parseInt(daily?.rooms_reset ?? '0', 10)));
    lines.push(metric('albionmapper_daily_rooms_deleted_total', 'Rooms deleted today (Europe/London)', 'gauge', parseInt(daily?.rooms_deleted ?? '0', 10)));
    lines.push(metric('albionmapper_daily_rooms_aborted_total', 'Rooms auto-deleted today for being created but never used (Europe/London)', 'gauge', parseInt(daily?.rooms_aborted ?? '0', 10)));
    lines.push(metric('albionmapper_daily_rooms_abandoned_total', 'Rooms auto-deleted today for being abandoned after modification (Europe/London)', 'gauge', parseInt(daily?.rooms_abandoned ?? '0', 10)));
    lines.push(metric('albionmapper_daily_memory_wiped_full_total', 'Full memory wipes performed today (Europe/London)', 'gauge', parseInt(daily?.memory_wiped_full ?? '0', 10)));
    lines.push(metric('albionmapper_daily_memory_wiped_single_total', 'Single memory wipes performed today (Europe/London)', 'gauge', parseInt(daily?.memory_wiped_single ?? '0', 10)));
    lines.push(metric('albionmapper_daily_passwords_rotated_total', 'Password rotations performed today (Europe/London)', 'gauge', parseInt(daily?.passwords_rotated ?? '0', 10)));
    lines.push(metric('albionmapper_daily_peak_concurrent', 'Peak concurrent WebSocket connections today (Europe/London)', 'gauge', parseInt(daily?.peak_concurrent ?? '0', 10)));
    lines.push(metric('albionmapper_daily_unique_tokens_active', 'Unique authenticated tokens seen today (Europe/London)', 'gauge', parseInt(daily?.unique_tokens_active ?? '0', 10)));
    lines.push(metric('albionmapper_daily_zones_added_roads_total', 'Road zones added today (Europe/London)', 'gauge', parseInt(daily?.zones_added ?? '0', 10)));
    lines.push(metric('albionmapper_daily_zones_added_nonroads_total', 'Non-road zones added today (Europe/London)', 'gauge', parseInt(daily?.non_roads_zones_added ?? '0', 10)));
    lines.push(metric('albionmapper_daily_room_data_updates_total', 'Total room data update events today (Europe/London)', 'gauge', parseInt(daily?.room_data_updates ?? '0', 10)));
    lines.push(metric('albionmapper_daily_routes_plotted_total', 'Routes plotted today (Europe/London)', 'gauge', parseInt(daily?.routes_plotted ?? '0', 10)));
    lines.push(metric('albionmapper_daily_tokens_issued_total', 'Tokens issued today (Europe/London)', 'gauge', parseInt(daily?.tokens_issued ?? '0', 10)));

    // --- All-time room cleanup stats ---
    lines.push(metric('albionmapper_rooms_aborted_total', 'All-time total rooms auto-deleted for being created but never used', 'gauge', totalRoomsAborted));
    lines.push(metric('albionmapper_rooms_abandoned_total', 'All-time total rooms auto-deleted for being abandoned after modification', 'gauge', totalRoomsAbandoned));

    // --- Map History stats ---
    lines.push(metric('albionmapper_history_entries_total', 'Total number of unique room-map history entries (excluding home zones)', 'gauge', totalHistoryEntries));

    const mapHistorySeries = mapHistoryRows
      .map(r => ({ labels: { zone_id: r.zone_id }, value: parseInt(r.total_mentions ?? '0', 10) }))
      .filter(s => s.value > 0);
    if (mapHistorySeries.length > 0) {
      lines.push(metricLabeled('albionmapper_map_history_mentions_total', 'Total number of unique rooms each map has appeared in (excluding home zones)', 'gauge', mapHistorySeries));
    }

    const roomHistorySeries = roomHistoryRows
      .map(r => ({ labels: { room_id: r.room_id }, value: parseInt(r.total_entries ?? '0', 10) }))
      .filter(s => s.value > 0);
    if (roomHistorySeries.length > 0) {
      lines.push(metricLabeled('albionmapper_room_history_size_total', 'Total number of unique maps in each room history (excluding home zone)', 'gauge', roomHistorySeries));
    }

    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(lines.join('\n'));
  });
}