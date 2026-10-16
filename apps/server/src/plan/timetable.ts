// The imported GTFS turned into the compact layout the built-in planner scans
// (packages/core/src/timetable.ts, raptor.ts): the stops and the walking links
// between them once per feed, and each service date's trips grouped into
// patterns when a plan first needs that date.

import type { DatabaseSync } from 'node:sqlite';
import {
  activeServiceIds,
  addDays,
  decodeDay,
  decodeNetwork,
  DETOUR_FACTOR,
  encodeDay,
  encodeNetwork,
  haversineMeters,
  NO_ALIGHT,
  NO_BOARD,
  serviceDateBase,
  type CalendarException,
  type CalendarRow,
  type DayTimetable,
  type Network,
  type NetworkRoute,
  type ServiceDate,
} from '@twalk/core';

/** Stops this close (straight line) are linked by a walk. */
const LINK_METERS = 400;
/** Changing platforms inside a station, when the MBTA gives no time. */
const SAME_STATION_S = 120;
/** Service dates kept built at once. */
const DAYS_KEPT = 3;

interface Trip {
  id: string;
  routeId: string;
  headsign: string;
  stops: string[];
  flags: number[];
  arr: number[];
  dep: number[];
}

export class Timetable {
  readonly network: Network;
  private readonly stopIndex: Map<string, number>;
  private readonly routeIndex: Map<string, number>;
  private readonly calendar: CalendarRow[];
  private readonly exceptions: CalendarException[];
  private readonly days = new Map<ServiceDate, Promise<DayTimetable>>();

  private readonly db: DatabaseSync;
  readonly feedVersion: string;

  constructor(db: DatabaseSync, feedVersion: string) {
    this.db = db;
    this.feedVersion = feedVersion;
    this.calendar = (db.prepare('SELECT * FROM calendar').all() as { service_id: string; days: string; start_date: string; end_date: string }[]).map((r) => ({
      serviceId: r.service_id,
      days: [...r.days].map((c) => c === '1') as CalendarRow['days'],
      startDate: r.start_date,
      endDate: r.end_date,
    }));
    this.exceptions = (db.prepare('SELECT * FROM calendar_dates').all() as { service_id: string; date: string; exception_type: number }[]).map((r) => ({
      serviceId: r.service_id,
      date: r.date,
      exceptionType: r.exception_type === 1 ? 1 : 2,
    }));
    const built = buildNetwork(db, feedVersion);
    this.network = built.network;
    this.stopIndex = built.stopIndex;
    this.routeIndex = built.routeIndex;
  }

  /** A service date's trips, built on first use (a few seconds), kept for the next plans. */
  day(date: ServiceDate): Promise<DayTimetable> {
    let d = this.days.get(date);
    if (!d) {
      // Let the event loop breathe first: building takes a few seconds of CPU.
      d = new Promise<DayTimetable>((resolve, reject) => setImmediate(() => {
        try {
          resolve(this.buildDay(date));
        } catch (err) {
          reject(err as Error);
        }
      }));
      this.days.set(date, d);
      d.catch(() => this.days.delete(date));
      while (this.days.size > DAYS_KEPT) this.days.delete(this.days.keys().next().value!);
    }
    return d;
  }

  private tripsOf(date: ServiceDate): Trip[] {
    const services = [...activeServiceIds(date, this.calendar, this.exceptions)];
    if (services.length === 0) return [];
    const rows = this.db
      .prepare(
        `SELECT t.trip_id, t.route_id, t.headsign, st.stop_id, st.arr, st.dep, st.pickup_type, st.drop_off_type
         FROM trips t JOIN stop_times st USING (trip_id)
         WHERE t.service_id IN (SELECT value FROM json_each(?))
         ORDER BY t.trip_id, st.stop_sequence`,
      )
      .iterate(JSON.stringify(services)) as Iterable<{
      trip_id: string;
      route_id: string;
      headsign: string | null;
      stop_id: string;
      arr: number | null;
      dep: number | null;
      pickup_type: number | null;
      drop_off_type: number | null;
    }>;
    const trips: Trip[] = [];
    let cur = null as Trip | null;
    for (const r of rows) {
      if (cur?.id !== r.trip_id) {
        cur = { id: r.trip_id, routeId: r.route_id, headsign: r.headsign ?? '', stops: [], flags: [], arr: [], dep: [] };
        trips.push(cur);
      }
      const a = r.arr ?? r.dep;
      const d = r.dep ?? r.arr;
      if (a == null || d == null || !this.stopIndex.has(r.stop_id)) continue;
      cur.stops.push(r.stop_id);
      cur.flags.push((r.pickup_type === 1 ? NO_BOARD : 0) | (r.drop_off_type === 1 ? NO_ALIGHT : 0));
      cur.arr.push(a);
      cur.dep.push(d);
    }
    return trips.filter((t) => t.stops.length >= 2 && this.routeIndex.has(t.routeId));
  }

  /** One date's trips, plus the day before's still running after midnight, in RAPTOR's layout. */
  buildDay(date: ServiceDate): DayTimetable {
    const shift = (serviceDateBase(date) - serviceDateBase(addDays(date, -1))) / 1000; // 86400 unless the clocks change
    const items = [
      ...this.tripsOf(date).map((trip) => ({ trip, offset: 0 })),
      ...this.tripsOf(addDays(date, -1))
        .filter((t) => t.dep[t.dep.length - 1]! >= shift)
        .map((trip) => ({ trip, offset: -shift })),
    ]
      .map(({ trip, offset }) => ({ trip, arr: trip.arr.map((x) => x + offset), dep: trip.dep.map((x) => x + offset) }))
      .sort((a, b) => a.dep[0]! - b.dep[0]!);

    // A trip that would overtake the one before it gets a pattern of its own:
    // RAPTOR finds trips by departure time at each stop.
    interface Pattern {
      route: number;
      stops: number[];
      flags: number[];
      trips: { trip: Trip; start: number; arr: number[]; dep: number[] }[];
    }
    const byKey = new Map<string, Pattern[]>();
    for (const t of items) {
      const key = `${t.trip.routeId}|${t.trip.stops.join(',')}|${t.trip.flags.join('')}`;
      const variants = byKey.get(key) ?? [];
      byKey.set(key, variants);
      let p = variants.find((v) => {
        const last = v.trips[v.trips.length - 1]!;
        return t.dep.every((d, i) => d >= last.dep[i]! && t.arr[i]! >= last.arr[i]!);
      });
      if (!p) {
        p = { route: this.routeIndex.get(t.trip.routeId)!, stops: t.trip.stops.map((s) => this.stopIndex.get(s)!), flags: t.trip.flags, trips: [] };
        variants.push(p);
      }
      p.trips.push({ trip: t.trip, start: t.dep[0]!, arr: t.arr, dep: t.dep });
    }
    const patterns = [...byKey.values()].flat();

    const stopCount = patterns.reduce((n, p) => n + p.stops.length, 0);
    const tripCount = patterns.reduce((n, p) => n + p.trips.length, 0);
    const patRoute = new Uint16Array(patterns.length);
    const patStopsOff = new Uint32Array(patterns.length + 1);
    const patTripsOff = new Uint32Array(patterns.length + 1);
    const patStops = new Uint32Array(stopCount);
    const patFlags = new Uint8Array(stopCount);
    const tripStart = new Int32Array(tripCount);
    const tripTimesOff = new Uint32Array(tripCount);
    const times = new Uint16Array(patterns.reduce((n, p) => n + p.trips.length * p.stops.length * 2, 0));
    const tripIds: string[] = [];
    const headsigns: string[] = [];
    let si = 0;
    let ti = 0;
    let wi = 0;
    patterns.forEach((p, pi) => {
      patRoute[pi] = p.route;
      patStopsOff[pi] = si;
      patTripsOff[pi] = ti;
      p.stops.forEach((s, i) => {
        patStops[si] = s;
        patFlags[si++] = p.flags[i]!;
      });
      for (const t of p.trips) {
        tripStart[ti] = t.start;
        tripTimesOff[ti] = wi;
        tripIds.push(t.trip.id);
        headsigns.push(t.trip.headsign);
        for (let i = 0; i < p.stops.length; i++) {
          times[wi++] = Math.max(0, Math.min(65535, t.arr[i]! - t.start));
          times[wi++] = Math.max(0, Math.min(65535, t.dep[i]! - t.start));
        }
        ti++;
      }
    });
    patStopsOff[patterns.length] = si;
    patTripsOff[patterns.length] = ti;
    const bytes = encodeDay(
      { date, feedVersion: this.feedVersion, tripIds, headsigns },
      { patRoute, patStopsOff, patStops, patFlags, patTripsOff, tripStart, tripTimesOff, times },
    );
    return decodeDay(bytes, this.network.lat.length);
  }
}

/** Every stop with scheduled service, and the walking links between them. */
function buildNetwork(db: DatabaseSync, feedVersion: string): { network: Network; stopIndex: Map<string, number>; routeIndex: Map<string, number> } {
  type StopRow = { stop_id: string; name: string; lat: number; lon: number; parent_station: string | null; parent_name: string | null };
  const rows = db
    .prepare(
      `SELECT s.stop_id, s.name, s.lat, s.lon, NULLIF(s.parent_station, '') AS parent_station, p.name AS parent_name
       FROM stops s LEFT JOIN stops p ON p.stop_id = NULLIF(s.parent_station, '')
       WHERE s.stop_id IN (SELECT DISTINCT stop_id FROM stop_times) AND s.lat IS NOT NULL`,
    )
    .all() as StopRow[];
  const ids = rows.map((r) => r.stop_id);
  const stopIndex = new Map(ids.map((id, i) => [id, i]));
  const lat = Float32Array.from(rows.map((r) => r.lat));
  const lon = Float32Array.from(rows.map((r) => r.lon));
  const parentKeys = new Map<string, number>();
  const parent = Int32Array.from(rows.map((r) => (r.parent_station ? (parentKeys.get(r.parent_station) ?? parentKeys.set(r.parent_station, parentKeys.size).get(r.parent_station)!) : -1)));
  const stopNames = rows.map((r) => r.parent_name ?? r.name);

  // The MBTA's transfer times (type 2) and changes it says can't be made (type 3).
  const minTransfer = new Map<string, number>();
  const noTransfer = new Set<string>();
  for (const t of db.prepare('SELECT from_stop_id f, to_stop_id t, transfer_type k, min_transfer_time m FROM transfers WHERE from_trip_id IS NULL').all() as {
    f: string;
    t: string;
    k: number;
    m: number | null;
  }[]) {
    if (t.k === 3) noTransfer.add(`${t.f}>${t.t}`);
    else if (t.k === 2 && t.m != null) minTransfer.set(`${t.f}>${t.t}`, t.m);
  }

  const cell = (a: number) => Math.floor(a / 0.005);
  const grid = new Map<string, number[]>();
  ids.forEach((_, s) => {
    const k = `${cell(lat[s]!)}:${cell(lon[s]!)}`;
    const list = grid.get(k);
    if (list) list.push(s);
    else grid.set(k, [s]);
  });
  const links: { to: number; meters: number; minS: number }[][] = ids.map(() => []);
  const link = (s: number, n: number, minS: number) =>
    links[s]!.push({ to: n, meters: Math.min(65535, Math.round(haversineMeters(lat[s]!, lon[s]!, lat[n]!, lon[n]!) * DETOUR_FACTOR)), minS: Math.min(65535, minS) });
  ids.forEach((id, s) => {
    const cy = cell(lat[s]!);
    const cx = cell(lon[s]!);
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        for (const n of grid.get(`${y}:${x}`) ?? []) {
          if (n === s) continue;
          const key = `${id}>${ids[n]}`;
          if (noTransfer.has(key) || haversineMeters(lat[s]!, lon[s]!, lat[n]!, lon[n]!) > LINK_METERS) continue;
          const sameStation = parent[s]! >= 0 && parent[s] === parent[n];
          link(s, n, minTransfer.get(key) ?? (sameStation ? SAME_STATION_S : 0));
        }
      }
    }
  });
  // Transfers the MBTA lists between stops further apart (connected underground).
  for (const [key, m] of minTransfer) {
    const [f, t] = key.split('>') as [string, string];
    const s = stopIndex.get(f);
    const n = stopIndex.get(t);
    if (s != null && n != null && s !== n && !links[s]!.some((l) => l.to === n)) link(s, n, m);
  }
  const fpOffsets = new Uint32Array(ids.length + 1);
  links.forEach((l, s) => (fpOffsets[s + 1] = fpOffsets[s]! + l.length));
  const flat = links.flat();

  const routeRows = db.prepare('SELECT route_id, route_type, short_name, long_name, color, text_color FROM routes').all() as {
    route_id: string;
    route_type: number | null;
    short_name: string | null;
    long_name: string | null;
    color: string | null;
    text_color: string | null;
  }[];
  const routeIndex = new Map(routeRows.map((r, i) => [r.route_id, i]));
  const routes: NetworkRoute[] = routeRows.map((r) => {
    const name = r.long_name || r.short_name || r.route_id;
    return { id: r.route_id, label: r.short_name || name.replace(/ Line$/, ''), name, routeType: r.route_type ?? 3, color: r.color || null, textColor: r.text_color || null };
  });

  const bytes = encodeNetwork(
    { feedVersion, builtAt: new Date().toISOString(), stopIds: ids, stopNames, routes },
    {
      lat,
      lon,
      parent,
      fpOffsets,
      fpTo: Uint32Array.from(flat.map((l) => l.to)),
      fpMeters: Uint16Array.from(flat.map((l) => l.meters)),
      fpMinS: Uint16Array.from(flat.map((l) => l.minS)),
    },
  );
  return { network: decodeNetwork(bytes), stopIndex, routeIndex };
}
