// Read-only queries over the imported GTFS database.

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import {
  activeServiceIds,
  addDays,
  haversineMeters,
  localDate,
  modeFromRouteType,
  serviceDateBase,
  type CalendarException,
  type CalendarRow,
  type Mode,
  type RouteInfo,
  type ScheduledStopTime,
  type StopSummary,
} from '@twalk/core';

interface StopRow {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  location_type: number;
  parent_station: string | null;
  platform_code: string | null;
  wheelchair_boarding: number;
}

export interface Entrance {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  wheelchairBoarding: number;
}

const json = (v: unknown) => JSON.stringify(v);

export class GtfsDb {
  readonly path: string;
  private db: DatabaseSync;
  private routeMap: Map<string, RouteInfo>;
  private calendar: CalendarRow[];
  private exceptions: CalendarException[];
  private serviceCache = new Map<string, Set<string>>();
  private headsignCache = new Map<string, string | null>();
  private stopCache = new Map<string, StopRow | null>();
  private stmts: Record<string, StatementSync>;
  readonly feedVersion: string | null;

  constructor(path: string) {
    this.path = path;
    this.db = new DatabaseSync(path, { readOnly: true });
    this.db.exec('PRAGMA query_only = ON;');
    this.stmts = {
      stop: this.db.prepare('SELECT * FROM stops WHERE stop_id = ?'),
      children: this.db.prepare('SELECT stop_id FROM stops WHERE parent_station = ? AND location_type = 0'),
      entrances: this.db.prepare(
        'SELECT stop_id, name, lat, lon, wheelchair_boarding FROM stops WHERE parent_station = ? AND location_type = 2',
      ),
      headsign: this.db.prepare('SELECT headsign FROM trips WHERE trip_id = ?'),
      stopRoutes: this.db.prepare('SELECT route_id FROM stop_routes WHERE stop_id = ?'),
      box: this.db.prepare(`
        SELECT s.* FROM stops s
        WHERE s.lat BETWEEN ? AND ? AND s.lon BETWEEN ? AND ?
          AND (s.location_type = 1 OR (s.location_type = 0 AND (s.parent_station IS NULL OR s.parent_station = '')))
          AND EXISTS (SELECT 1 FROM stop_routes r WHERE r.stop_id = s.stop_id)`),
      search: this.db.prepare(`
        SELECT s.* FROM stops s
        WHERE s.name LIKE ? ESCAPE '\\'
          AND (s.location_type = 1 OR (s.location_type = 0 AND (s.parent_station IS NULL OR s.parent_station = '')))
          AND EXISTS (SELECT 1 FROM stop_routes r WHERE r.stop_id = s.stop_id)
        ORDER BY s.location_type DESC, (s.name LIKE ? ESCAPE '\\') DESC, (s.name LIKE ? ESCAPE '\\') DESC, length(s.name) LIMIT ?`),
      schedules: this.db.prepare(`
        SELECT st.trip_id, st.stop_id, st.stop_sequence, st.arr, st.dep, st.stop_headsign,
               st.pickup_type, st.drop_off_type, t.route_id, t.direction_id, t.headsign, ts.start_secs
        FROM stop_times st
        JOIN trips t ON t.trip_id = st.trip_id
        JOIN trip_start ts ON ts.trip_id = st.trip_id
        WHERE st.stop_id IN (SELECT value FROM json_each(?))
          AND st.dep BETWEEN ? AND ?
          AND t.service_id IN (SELECT value FROM json_each(?))`),
    };
    this.routeMap = this.loadRoutes();
    this.calendar = (this.db.prepare('SELECT * FROM calendar').all() as { service_id: string; days: string; start_date: string; end_date: string }[]).map(
      (r) => ({
        serviceId: r.service_id,
        days: [...r.days].map((c) => c === '1') as CalendarRow['days'],
        startDate: r.start_date,
        endDate: r.end_date,
      }),
    );
    this.exceptions = (this.db.prepare('SELECT * FROM calendar_dates').all() as { service_id: string; date: string; exception_type: number }[]).map(
      (r) => ({ serviceId: r.service_id, date: r.date, exceptionType: r.exception_type === 1 ? 1 : 2 }),
    );
    const v = this.db.prepare(`SELECT value FROM meta WHERE key = 'feed_version'`).get() as { value: string } | undefined;
    this.feedVersion = v?.value ?? null;
  }

  close(): void {
    this.db.close();
  }

  private loadRoutes(): Map<string, RouteInfo> {
    const dirs = new Map<string, { direction: string; destination: string }>();
    for (const d of this.db.prepare('SELECT * FROM directions').all() as { route_id: string; direction_id: number; direction: string; destination: string }[]) {
      dirs.set(`${d.route_id}|${d.direction_id}`, { direction: d.direction ?? '', destination: d.destination ?? '' });
    }
    const map = new Map<string, RouteInfo>();
    for (const r of this.db.prepare('SELECT * FROM routes').all() as {
      route_id: string; route_type: number; short_name: string; long_name: string; color: string; text_color: string; sort_order: number; listed: number; fare_class: string | null;
    }[]) {
      const d0 = dirs.get(`${r.route_id}|0`);
      const d1 = dirs.get(`${r.route_id}|1`);
      map.set(r.route_id, {
        id: r.route_id,
        mode: modeFromRouteType(r.route_type),
        shortName: r.short_name,
        longName: r.long_name,
        color: r.color,
        textColor: r.text_color,
        sortOrder: r.sort_order,
        listed: r.listed === 1,
        fareClass: r.fare_class ?? null,
        directionNames: [d0?.direction ?? 'Outbound', d1?.direction ?? 'Inbound'],
        directionDestinations: [d0?.destination ?? '', d1?.destination ?? ''],
      });
    }
    return map;
  }

  routes(): ReadonlyMap<string, RouteInfo> {
    return this.routeMap;
  }

  private stopRow(id: string): StopRow | null {
    let row = this.stopCache.get(id);
    if (row === undefined) {
      row = (this.stmts.stop!.get(id) as StopRow | undefined) ?? null;
      this.stopCache.set(id, row);
    }
    return row;
  }

  /** The stop a rider picks: a station, or a bus stop that isn't inside one. */
  topLevelId(stopId: string): string {
    const row = this.stopRow(stopId);
    return row?.parent_station ? row.parent_station : stopId;
  }

  stop(id: string): StopSummary | null {
    const row = this.stopRow(id);
    return row ? this.summary(row) : null;
  }

  private summary(row: StopRow): StopSummary {
    const routeIds = (this.stmts.stopRoutes!.all(row.stop_id) as { route_id: string }[])
      .map((r) => r.route_id)
      .filter((id) => this.routeMap.has(id))
      .sort((a, b) => this.routeMap.get(a)!.sortOrder - this.routeMap.get(b)!.sortOrder);
    const modes = [...new Set(routeIds.map((id) => this.routeMap.get(id)!.mode))] as Mode[];
    return {
      id: row.stop_id,
      name: row.name,
      latitude: row.lat,
      longitude: row.lon,
      isStation: row.location_type === 1,
      modes,
      routeIds,
      wheelchairBoarding: (row.wheelchair_boarding ?? 0) as 0 | 1 | 2,
    };
  }

  /** The platforms whose predictions belong to this stop. */
  platformIds(stopId: string): string[] {
    const row = this.stopRow(stopId);
    if (!row) return [];
    if (row.location_type !== 1) return [stopId];
    return (this.stmts.children!.all(stopId) as { stop_id: string }[]).map((r) => r.stop_id);
  }

  platformCodes(stopIds: readonly string[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const id of stopIds) {
      const code = this.stopRow(id)?.platform_code;
      if (code) out.set(id, code);
    }
    return out;
  }

  entrances(stationId: string): Entrance[] {
    return (this.stmts.entrances!.all(stationId) as { stop_id: string; name: string; lat: number; lon: number; wheelchair_boarding: number }[]).map(
      (r) => ({ id: r.stop_id, name: r.name, latitude: r.lat, longitude: r.lon, wheelchairBoarding: r.wheelchair_boarding }),
    );
  }

  /** Stops within `radiusM` of a point, nearest first, by straight-line distance. */
  nearby(lat: number, lon: number, radiusM: number, limit: number): { stop: StopSummary; meters: number; entrance: Entrance | null }[] {
    const dLat = radiusM / 111_320;
    const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
    const rows = this.stmts.box!.all(lat - dLat, lat + dLat, lon - dLon, lon + dLon) as unknown as StopRow[];
    const scored = rows.map((row) => {
      let meters = haversineMeters(lat, lon, row.lat, row.lon);
      let entrance: Entrance | null = null;
      if (row.location_type === 1) {
        // You walk to a door, not to the middle of the station.
        for (const e of this.entrances(row.stop_id)) {
          const m = haversineMeters(lat, lon, e.latitude, e.longitude);
          if (!entrance || m < meters) {
            meters = m;
            entrance = e;
          }
        }
      }
      return { row, meters, entrance };
    });
    return scored
      .filter((s) => s.meters <= radiusM)
      .sort((a, b) => a.meters - b.meters)
      .slice(0, limit)
      .map((s) => ({ stop: this.summary(s.row), meters: s.meters, entrance: s.entrance }));
  }

  search(query: string, limit = 20): StopSummary[] {
    const q = query.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
    if (q.length < 2) return [];
    // Stations first; within them, names that start with the query, then a word that does ("Park": Park Street before Hyde Park).
    return (this.stmts.search!.all(`%${q}%`, `${q}%`, `% ${q}%`, limit) as unknown as StopRow[]).map((r) => this.summary(r));
  }

  tripHeadsign(tripId: string): string | null {
    let h = this.headsignCache.get(tripId);
    if (h === undefined) {
      const row = this.stmts.headsign!.get(tripId) as { headsign: string } | undefined;
      h = row?.headsign || null;
      if (this.headsignCache.size > 50_000) this.headsignCache.clear();
      this.headsignCache.set(tripId, h);
    }
    return h;
  }

  hasTrip(tripId: string): boolean {
    return this.tripHeadsign(tripId) !== null || this.stmts.headsign!.get(tripId) !== undefined;
  }

  activeServices(date: string): Set<string> {
    let s = this.serviceCache.get(date);
    if (!s) {
      s = activeServiceIds(date, this.calendar, this.exceptions);
      if (this.serviceCache.size > 14) this.serviceCache.clear();
      this.serviceCache.set(date, s);
    }
    return s;
  }

  /** Scheduled calls at these platforms between two instants, across service days. */
  schedules(stopIds: readonly string[], fromMs: number, toMs: number): ScheduledStopTime[] {
    if (stopIds.length === 0) return [];
    const today = localDate(fromMs);
    const out: ScheduledStopTime[] = [];
    for (const date of [addDays(today, -1), today, addDays(today, 1)]) {
      const base = serviceDateBase(date);
      const lo = Math.floor((fromMs - base) / 1000);
      const hi = Math.ceil((toMs - base) / 1000);
      if (hi < 0 || lo > 40 * 3600) continue;
      const services = [...this.activeServices(date)];
      if (services.length === 0) continue;
      const rows = this.stmts.schedules!.all(json(stopIds), lo, hi, json(services)) as {
        trip_id: string; stop_id: string; stop_sequence: number; arr: number | null; dep: number | null;
        stop_headsign: string | null; pickup_type: number; drop_off_type: number; route_id: string;
        direction_id: number; headsign: string; start_secs: number;
      }[];
      for (const r of rows) {
        out.push({
          tripId: r.trip_id,
          routeId: r.route_id,
          directionId: r.direction_id === 1 ? 1 : 0,
          headsign: r.stop_headsign || r.headsign,
          stopId: r.stop_id,
          stopSequence: r.stop_sequence,
          serviceDate: date,
          arrivalTime: r.arr == null ? null : base + r.arr * 1000,
          departureTime: r.dep == null ? null : base + r.dep * 1000,
          pickupType: r.pickup_type,
          dropOffType: r.drop_off_type,
          tripStartTime: base + r.start_secs * 1000,
        });
      }
    }
    return out;
  }

  private tripShapeCache = new Map<string, string | null>();

  /** The GTFS shape a scheduled trip follows; null for trips not in the schedule (ADDED). */
  tripShapeId(tripId: string): string | null {
    let s = this.tripShapeCache.get(tripId);
    if (s === undefined) {
      const row = this.db.prepare('SELECT shape_id FROM trips WHERE trip_id = ?').get(tripId) as { shape_id: string | null } | undefined;
      s = row?.shape_id ?? null;
      if (this.tripShapeCache.size > 50_000) this.tripShapeCache.clear();
      this.tripShapeCache.set(tripId, s);
    }
    return s;
  }

  /**
   * The shapes worth drawing for a route: per direction, the most-used one
   * plus any other used by at least 15% of that direction's trips (branches).
   */
  routeShapes(routeId: string): { shapeId: string; directionId: 0 | 1; main: boolean; coords: [number, number][] }[] {
    const usage = this.db
      .prepare('SELECT shape_id, direction_id, COUNT(*) AS n FROM trips WHERE route_id = ? AND shape_id IS NOT NULL GROUP BY shape_id, direction_id ORDER BY n DESC')
      .all(routeId) as { shape_id: string; direction_id: number; n: number }[];
    const points = this.db.prepare('SELECT lon, lat FROM shapes WHERE shape_id = ? ORDER BY seq');
    const out: { shapeId: string; directionId: 0 | 1; main: boolean; coords: [number, number][] }[] = [];
    for (const dir of [0, 1] as const) {
      const rows = usage.filter((u) => u.direction_id === dir);
      const total = rows.reduce((a, r) => a + r.n, 0);
      rows.forEach((r, i) => {
        if (i > 0 && r.n / total < 0.15) return;
        const coords = (points.all(r.shape_id) as { lon: number; lat: number }[]).map((p) => [p.lon, p.lat] as [number, number]);
        if (coords.length >= 2) out.push({ shapeId: r.shape_id, directionId: dir, main: i === 0, coords });
      });
    }
    return out;
  }

  /** Every station and stop served by rail or ferry, for the map. */
  railStops(): StopSummary[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT s.* FROM stops s JOIN stop_routes sr ON sr.stop_id = s.stop_id JOIN routes r ON r.route_id = sr.route_id
         WHERE r.route_type IN (0, 1, 2, 4) AND r.listed = 1`,
      )
      .all() as unknown as StopRow[];
    return rows.map((r) => this.summary(r));
  }

  /** Bus stops inside a box (for the map at street zoom). */
  busStopsIn(west: number, south: number, east: number, north: number, limit: number): StopSummary[] {
    const rows = this.db
      .prepare(
        `SELECT s.* FROM stops s WHERE s.lat BETWEEN ? AND ? AND s.lon BETWEEN ? AND ? AND s.location_type = 0
           AND (s.parent_station IS NULL OR s.parent_station = '')
           AND EXISTS (SELECT 1 FROM stop_routes sr JOIN routes r ON r.route_id = sr.route_id
                       WHERE sr.stop_id = s.stop_id AND r.route_type = 3 AND r.listed = 1)
         LIMIT ?`,
      )
      .all(south, north, west, east, limit) as unknown as StopRow[];
    return rows.map((r) => this.summary(r));
  }

  /** A stop's position (platforms included), for capping vehicle motion at its next stop. */
  stopPosition(stopId: string): { lat: number; lon: number } | null {
    const r = this.stopRow(stopId);
    return r ? { lat: r.lat, lon: r.lon } : null;
  }

  /** All route ids, for the V3 prediction stream filter. */
  routeIdsByType(): Map<number, string[]> {
    const out = new Map<number, string[]>();
    for (const r of this.db.prepare('SELECT route_id, route_type FROM routes ORDER BY sort_order').all() as { route_id: string; route_type: number }[]) {
      const list = out.get(r.route_type) ?? [];
      list.push(r.route_id);
      out.set(r.route_type, list);
    }
    return out;
  }
}
