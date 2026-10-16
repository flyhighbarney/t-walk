// Generates the replay scenarios in fixtures/replay/ against fixtures/gtfs/.
// Run: node tools/replay/make-fixtures.ts
//
// The events are in exactly the format the recorder writes (and the V3 /
// GTFS-RT payloads in the shapes seen live on 2026-10-15), so replaying them
// goes through the same parsing as real traffic. The scenarios are made up;
// real recordings (npm run record) can sit next to them once an API key is set.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StreamName, UpstreamEvent } from '../../apps/server/src/live/events.ts';

const OUT = new URL('../../fixtures/replay/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const S = 1000;
const MIN = 60 * S;
const iso = (t: number | null) => (t == null ? null : new Date(t).toISOString());

interface P {
  trip: string;
  route: string;
  stop: string;
  seq: number;
  dir?: 0 | 1;
  arr: number | null;
  dep: number | null;
  unc?: number | null;
  rel?: string | null;
  status?: string | null;
  vehicle?: string | null;
  headsign?: string | null;
}

const predId = (p: P) => `prediction-${p.trip}-${p.stop}-${p.seq}-${p.route}`;

function v3Pred(p: P) {
  return {
    attributes: {
      arrival_time: iso(p.arr),
      arrival_uncertainty: p.arr == null ? null : (p.unc ?? null),
      departure_time: iso(p.dep),
      departure_uncertainty: p.dep == null ? null : (p.unc ?? null),
      direction_id: p.dir ?? 0,
      last_trip: false,
      revenue: 'REVENUE',
      schedule_relationship: p.rel ?? null,
      status: p.status ?? null,
      stop_sequence: p.seq,
      trip_headsign: p.headsign ?? null,
      update_type: 'MID_TRIP',
    },
    id: predId(p),
    relationships: {
      route: { data: { id: p.route, type: 'route' } },
      stop: { data: { id: p.stop, type: 'stop' } },
      trip: { data: { id: p.trip, type: 'trip' } },
      vehicle: { data: p.vehicle ? { id: p.vehicle, type: 'vehicle' } : null },
    },
    type: 'prediction',
  };
}

interface V {
  id: string;
  trip: string;
  route: string;
  stop: string;
  status: 'INCOMING_AT' | 'STOPPED_AT' | 'IN_TRANSIT_TO';
  lat: number;
  lon: number;
  at: number;
}

function v3Vehicle(v: V) {
  return {
    attributes: {
      bearing: 180,
      carriages: [],
      current_status: v.status,
      current_stop_sequence: 10,
      direction_id: 0,
      label: v.id,
      latitude: v.lat,
      longitude: v.lon,
      occupancy_status: null,
      revenue: 'REVENUE',
      speed: null,
      updated_at: iso(v.at),
    },
    id: v.id,
    relationships: {
      route: { data: { id: v.route, type: 'route' } },
      stop: { data: { id: v.stop, type: 'stop' } },
      trip: { data: { id: v.trip, type: 'trip' } },
    },
    type: 'vehicle',
  };
}

function gtfsrtFeed(t: number, preds: P[]) {
  const byTrip = new Map<string, P[]>();
  for (const p of preds) byTrip.set(p.trip, [...(byTrip.get(p.trip) ?? []), p]);
  return {
    header: { timestamp: Math.floor(t / 1000), gtfs_realtime_version: '2.0', incrementality: 'FULL_DATASET' },
    entity: [...byTrip].map(([trip, ps]) => ({
      id: trip,
      trip_update: {
        timestamp: Math.floor(t / 1000),
        stop_time_update: ps.map((p) => ({
          stop_id: p.stop,
          stop_sequence: p.seq,
          ...(p.arr != null ? { arrival: { time: Math.floor(p.arr / 1000), ...(p.unc != null ? { uncertainty: p.unc } : {}) } } : {}),
          ...(p.dep != null ? { departure: { time: Math.floor(p.dep / 1000), ...(p.unc != null ? { uncertainty: p.unc } : {}) } } : {}),
          ...(p.status ? { boarding_status: p.status } : {}),
        })),
        trip: { trip_id: trip, route_id: ps[0]!.route, direction_id: ps[0]!.dir ?? 0, revenue: true, last_trip: false },
        ...(ps[0]!.vehicle ? { vehicle: { id: ps[0]!.vehicle } } : {}),
      },
    })),
  };
}

class Scenario {
  readonly events: UpstreamEvent[] = [];
  open(t: number, ...streams: StreamName[]) {
    for (const stream of streams) this.events.push({ t, stream, kind: 'open' });
  }
  close(t: number, reason: string, ...streams: StreamName[]) {
    for (const stream of streams) this.events.push({ t, stream, kind: 'close', reason });
  }
  msg(t: number, stream: StreamName, event: string, data: unknown) {
    this.events.push({ t, stream, kind: 'message', event, data: JSON.stringify(data) });
  }
  write(name: string, note: string) {
    const lines = [`// ${note}`, ...this.events.sort((a, b) => a.t - b.t).map((e) => JSON.stringify(e))];
    writeFileSync(join(OUT, `${name}.ndjson`), `${lines.join('\n')}\n`);
    console.log(`${name}: ${this.events.length} events`);
  }
}

const V3: StreamName[] = ['predictions-rail', 'predictions-bus', 'vehicles', 'alerts'];

/** Morning service at 8:00 AM on Thursday 2026-10-15. */
function morning(t0: number, opts: { delayed?: boolean } = {}) {
  const at = (m: number) => t0 + m * MIN;
  const rail: P[] = [
    // A train at the platform now.
    { trip: 'ADDED-1', route: 'Red', stop: '70075', seq: 10, arr: t0 - 20 * S, dep: t0 + 40 * S, vehicle: 'R-1' },
    { trip: 'ADDED-2', route: 'Red', stop: '70075', seq: 10, arr: at(6), dep: at(6.5), vehicle: 'R-2' },
    { trip: 'ADDED-3', route: 'Red', stop: '70075', seq: 10, arr: at(13), dep: at(13.5), vehicle: 'R-3' },
    { trip: 'ADDED-4', route: 'Red', stop: '70076', seq: 10, dir: 1, arr: at(4), dep: at(4.5), headsign: 'Alewife', vehicle: 'R-4' },
    opts.delayed
      ? { trip: 'CR-501', route: 'CR-Worcester', stop: 'NEC-2287', seq: 1, arr: null, dep: at(35), status: 'Delayed' }
      : { trip: 'CR-501', route: 'CR-Worcester', stop: 'NEC-2287', seq: 2 - 1, arr: null, dep: at(20), status: 'On time' },
  ];
  const bus: P[] = opts.delayed
    ? [
        // Running very late, and the MBTA thinks it may be stalled (uncertainty 301).
        { trip: 'B-0750', route: '1', stop: 'B1', seq: 2, arr: at(12), dep: at(12), unc: 301, vehicle: 'y1' },
        // B-0805 has nothing live at all: it should have left B0 at 8:05.
      ]
    : [
        { trip: 'B-0750', route: '1', stop: 'B1', seq: 2, arr: at(5), dep: at(5), unc: 60, vehicle: 'y1' },
        // No real-time prediction available: schedule-based estimate.
        { trip: 'B-0805', route: '1', stop: 'B1', seq: 2, arr: at(19), dep: at(19), unc: 300 },
      ];
  const vehicles: V[] = [
    { id: 'R-1', trip: 'ADDED-1', route: 'Red', stop: '70075', status: 'STOPPED_AT', lat: 42.3564, lon: -71.0624, at: t0 - 2 * S },
    { id: 'R-2', trip: 'ADDED-2', route: 'Red', stop: '70074', status: 'IN_TRANSIT_TO', lat: 42.361, lon: -71.071, at: t0 - 3 * S },
    { id: 'y1', trip: 'B-0750', route: '1', stop: 'B1', status: 'IN_TRANSIT_TO', lat: 42.345, lon: -71.07, at: t0 - 5 * S },
  ];
  return { rail, bus, vehicles };
}

/** Keep the streams talking: one small update per stream every 15 s, as the real stream does. */
function heartbeat(sc: Scenario, from: number, to: number, data: { rail: P[]; bus: P[]; vehicles: V[] }) {
  for (let t = from; t <= to; t += 15 * S) {
    const r = data.rail[1]!;
    sc.msg(t, 'predictions-rail', 'update', v3Pred(r));
    if (data.bus[0]) sc.msg(t + 2 * S, 'predictions-bus', 'update', v3Pred(data.bus[0]));
    const v = data.vehicles[2]!;
    sc.msg(t + 4 * S, 'vehicles', 'update', v3Vehicle({ ...v, lat: v.lat + (t - from) / 1e9, at: t }));
  }
}

function resetAll(sc: Scenario, t: number, data: { rail: P[]; bus: P[]; vehicles: V[] }) {
  sc.open(t, ...V3);
  sc.msg(t + 200, 'predictions-rail', 'reset', data.rail.map(v3Pred));
  sc.msg(t + 300, 'predictions-bus', 'reset', data.bus.map(v3Pred));
  sc.msg(t + 400, 'vehicles', 'reset', data.vehicles.map(v3Vehicle));
  sc.msg(t + 500, 'alerts', 'reset', []);
}

mkdirSync(OUT, { recursive: true });
const T0 = Date.parse('2026-10-15T08:00:00-04:00');

{
  const sc = new Scenario();
  const d = morning(T0);
  resetAll(sc, T0 - 5 * S, d);
  heartbeat(sc, T0 + 10 * S, T0 + 5 * MIN, d);
  // A prediction removed mid-stream (the train left), and one added.
  sc.msg(T0 + 50 * S, 'predictions-rail', 'remove', { id: predId(d.rail[0]!), type: 'prediction' });
  sc.msg(T0 + 51 * S, 'predictions-rail', 'add', v3Pred({ trip: 'ADDED-5', route: 'Red', stop: '70075', seq: 10, arr: T0 + 20 * MIN, dep: T0 + 20.5 * MIN }));
  sc.write('normal', 'Normal weekday morning at 8:00 AM, 2026-10-15 (made up; see tools/replay/make-fixtures.ts)');
}

{
  const sc = new Scenario();
  const d = morning(T0, { delayed: true });
  resetAll(sc, T0 - 5 * S, d);
  heartbeat(sc, T0 + 10 * S, T0 + 12 * MIN, d);
  sc.write('delays', 'Delays: a stalled bus (uncertainty 301), a delayed train, and a bus trip with nothing live (ghost)');
}

{
  const sc = new Scenario();
  const d = morning(T0);
  resetAll(sc, T0 - 5 * S, d);
  heartbeat(sc, T0 + 10 * S, T0 + 55 * S, d);
  sc.close(T0 + 60 * S, 'network error', ...V3);
  // Back after 6 minutes, with fresh state.
  const later = morning(T0 + 6 * MIN);
  resetAll(sc, T0 + 6 * MIN, later);
  heartbeat(sc, T0 + 6 * MIN + 10 * S, T0 + 8 * MIN, later);
  sc.write('outage', 'Stream outage: every V3 stream drops at 8:01 and comes back at 8:06');
}

{
  const sc = new Scenario();
  const T = Date.parse('2026-10-16T01:00:00-04:00');
  const data = {
    rail: [] as P[],
    bus: [{ trip: 'B-LATE', route: '1', stop: 'B1', seq: 2, arr: T + 12 * MIN, dep: T + 12 * MIN, unc: 60, vehicle: 'y9' }] as P[],
    vehicles: [
      { id: 'y8', trip: 'none', route: '1', stop: 'B0', status: 'STOPPED_AT', lat: 42.335, lon: -71.076, at: T },
      { id: 'y8b', trip: 'none', route: '1', stop: 'B0', status: 'STOPPED_AT', lat: 42.335, lon: -71.076, at: T },
      { id: 'y9', trip: 'B-LATE', route: '1', stop: 'B0', status: 'IN_TRANSIT_TO', lat: 42.34, lon: -71.074, at: T },
    ] as V[],
  };
  resetAll(sc, T - 5 * S, data);
  for (let t = T + 10 * S; t <= T + 3 * MIN; t += 15 * S) {
    sc.msg(t, 'predictions-bus', 'update', v3Pred(data.bus[0]!));
    sc.msg(t + 1 * S, 'predictions-rail', 'reset', []);
  }
  sc.write('late-night', "Late night: 1:00 AM Friday; the 25:10 trip from Thursday's service");
}

{
  const sc = new Scenario();
  const d = morning(T0);
  resetAll(sc, T0 - 5 * S, d);
  heartbeat(sc, T0 + 10 * S, T0 + 25 * S, d);
  sc.close(T0 + 30 * S, 'HTTP 503', 'predictions-rail', 'predictions-bus');
  // The manager starts the GTFS-RT poller 20 s later.
  sc.open(T0 + 50 * S, 'gtfsrt-trip-updates');
  for (let t = T0 + 50 * S; t <= T0 + 3 * MIN; t += 10 * S) {
    sc.msg(t, 'gtfsrt-trip-updates', 'feed', gtfsrtFeed(t - 4 * S, [...d.rail, ...d.bus]));
  }
  sc.write('fallback', 'V3 prediction streams fail at 8:00:30; the GTFS-realtime feed takes over at 8:00:50');
}
