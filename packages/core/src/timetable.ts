// The compact timetable the phone plans with, for the serverless "Get ready" app.
// Built once a day from the MBTA's GTFS (tools/timetable/build.ts) and read in the
// browser, so everything here is plain JavaScript: no Node APIs.
//
// Two kinds of file share one container (a JSON header, then typed arrays):
// - network.bin: the stops (rider-visible names and positions) and the walking
//   links between them. Changes only with the feed.
// - day-YYYYMMDD.bin: that service date's trips, grouped into patterns (a route
//   and an exact sequence of stops), in the layout RAPTOR scans. Times are
//   seconds from the date's GTFS zero point (noon minus 12 h, see time.ts), and
//   the previous date's trips that run past midnight are included, moved onto
//   this date's clock.
// A Thursday is about 160 KB gzipped, a Sunday about 90 KB.

import { haversineMeters } from './walking.ts';
import type { ServiceDate } from './time.ts';

export const TIMETABLE_VERSION = 1;

type Typed = Int32Array | Uint32Array | Uint16Array | Uint8Array | Float32Array;
const KINDS = { i32: Int32Array, u32: Uint32Array, u16: Uint16Array, u8: Uint8Array, f32: Float32Array } as const;
type KindName = keyof typeof KINDS;

function kindOf(a: Typed): KindName {
  if (a instanceof Int32Array) return 'i32';
  if (a instanceof Uint32Array) return 'u32';
  if (a instanceof Uint16Array) return 'u16';
  if (a instanceof Uint8Array) return 'u8';
  return 'f32';
}

/** [u32 header length][header JSON][padding to 4][arrays, each 4-byte aligned]. Little-endian, as every phone is. */
export function encodeContainer(header: object, arrays: Record<string, Typed>): Uint8Array {
  const layout: { name: string; kind: KindName; length: number; offset: number }[] = [];
  let offset = 0;
  for (const [name, a] of Object.entries(arrays)) {
    layout.push({ name, kind: kindOf(a), length: a.length, offset });
    offset += Math.ceil(a.byteLength / 4) * 4;
  }
  const json = new TextEncoder().encode(JSON.stringify({ ...header, arrays: layout }));
  const start = Math.ceil((4 + json.length) / 4) * 4;
  const out = new Uint8Array(start + offset);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  for (const l of layout) {
    const a = arrays[l.name]!;
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), start + l.offset);
  }
  return out;
}

export function decodeContainer<H>(bytes: Uint8Array): { header: H; arrays: Record<string, Typed> } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length))) as H & {
    arrays: { name: string; kind: KindName; length: number; offset: number }[];
  };
  const start = Math.ceil((4 + length) / 4) * 4;
  // Copy into a fresh aligned buffer so typed views are valid whatever the input's offset.
  const body = bytes.slice(start);
  const arrays: Record<string, Typed> = {};
  for (const l of header.arrays) arrays[l.name] = new KINDS[l.kind](body.buffer, l.offset, l.length);
  return { header, arrays };
}

// ---------------------------------------------------------------- network

export interface NetworkRoute {
  id: string;
  /** "Red", "1", "CR-Worcester" short label. */
  label: string;
  name: string;
  routeType: number;
  color: string | null;
  textColor: string | null;
}

export interface NetworkHeader {
  kind: 'network';
  version: number;
  feedVersion: string;
  builtAt: string;
  stopIds: string[];
  /** Rider-visible name: the station's for platforms. */
  stopNames: string[];
  routes: NetworkRoute[];
}

export interface Network {
  header: NetworkHeader;
  lat: Float32Array;
  lon: Float32Array;
  /** Index of the stop's station, or -1. */
  parent: Int32Array;
  /** Walking links: stop s's are fpTo[fpOffsets[s] .. fpOffsets[s+1]). */
  fpOffsets: Uint32Array;
  fpTo: Uint32Array;
  /** Straight-line metres × the detour factor. */
  fpMeters: Uint16Array;
  /** Minimum seconds the change takes (stairs, the MBTA's transfer times), whatever the pace. */
  fpMinS: Uint16Array;
  /** Grid buckets for nearby-stop lookups. */
  grid: Map<string, number[]>;
}

export interface NetworkArrays {
  lat: Float32Array;
  lon: Float32Array;
  parent: Int32Array;
  fpOffsets: Uint32Array;
  fpTo: Uint32Array;
  fpMeters: Uint16Array;
  fpMinS: Uint16Array;
}

export function encodeNetwork(header: Omit<NetworkHeader, 'kind' | 'version'>, arrays: NetworkArrays): Uint8Array {
  return encodeContainer({ kind: 'network', version: TIMETABLE_VERSION, ...header }, { ...arrays });
}

const CELL = 0.01; // about 1.1 km north-south, 0.8 km east-west in Boston
const cellKey = (lat: number, lon: number) => `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;

export function decodeNetwork(bytes: Uint8Array): Network {
  const { header, arrays } = decodeContainer<NetworkHeader>(bytes);
  if (header.kind !== 'network' || header.version !== TIMETABLE_VERSION) throw new Error('Not a T-Walk network file of this version');
  const a = arrays as unknown as NetworkArrays;
  const grid = new Map<string, number[]>();
  for (let s = 0; s < a.lat.length; s++) {
    const k = cellKey(a.lat[s]!, a.lon[s]!);
    const list = grid.get(k);
    if (list) list.push(s);
    else grid.set(k, [s]);
  }
  return { header, ...a, grid };
}

/** Stops within `radiusM` (straight line) of a point, with their straight-line distance. */
export function stopsNear(net: Network, lat: number, lon: number, radiusM: number): { stop: number; meters: number }[] {
  const out: { stop: number; meters: number }[] = [];
  const spanLat = Math.ceil(radiusM / 111_000 / CELL);
  const spanLon = Math.ceil(radiusM / (111_000 * Math.cos((lat * Math.PI) / 180)) / CELL);
  const cy = Math.floor(lat / CELL);
  const cx = Math.floor(lon / CELL);
  for (let y = cy - spanLat; y <= cy + spanLat; y++) {
    for (let x = cx - spanLon; x <= cx + spanLon; x++) {
      for (const s of net.grid.get(`${y}:${x}`) ?? []) {
        const m = haversineMeters(lat, lon, net.lat[s]!, net.lon[s]!);
        if (m <= radiusM) out.push({ stop: s, meters: m });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- one service date

export const NO_BOARD = 1;
export const NO_ALIGHT = 2;

export interface DayHeader {
  kind: 'day';
  version: number;
  date: ServiceDate;
  feedVersion: string;
  /** MBTA trip ids, by trip index (for live predictions). */
  tripIds: string[];
  /** Headsign per trip. */
  headsigns: string[];
}

export interface DayArrays {
  /** Route index (Network.header.routes) per pattern. */
  patRoute: Uint16Array;
  patStopsOff: Uint32Array;
  patStops: Uint32Array;
  /** Per pattern stop: NO_BOARD | NO_ALIGHT. */
  patFlags: Uint8Array;
  /** Pattern p's trips are tripStart[patTripsOff[p] .. patTripsOff[p+1]), earliest first. */
  patTripsOff: Uint32Array;
  /** Seconds from the date's zero point when the trip leaves its first stop. Negative for trips from the day before. */
  tripStart: Int32Array;
  /** Trip t's times are times[tripTimesOff[t] ..]: arrival then departure at each stop, as seconds after tripStart. */
  tripTimesOff: Uint32Array;
  times: Uint16Array;
}

export interface DayTimetable extends DayArrays {
  header: DayHeader;
  /** Patterns through each stop: stopPatterns[stopPatOff[s] .. stopPatOff[s+1]) as pattern * 65536 + position. */
  stopPatOff: Uint32Array;
  stopPat: Float64Array;
}

export function encodeDay(header: Omit<DayHeader, 'kind' | 'version'>, arrays: DayArrays): Uint8Array {
  return encodeContainer({ kind: 'day', version: TIMETABLE_VERSION, ...header }, { ...arrays });
}

export function decodeDay(bytes: Uint8Array, stopCount: number): DayTimetable {
  const { header, arrays } = decodeContainer<DayHeader>(bytes);
  if (header.kind !== 'day' || header.version !== TIMETABLE_VERSION) throw new Error('Not a T-Walk day file of this version');
  const a = arrays as unknown as DayArrays;
  // Invert pattern → stops into stop → (pattern, position), for RAPTOR's "which patterns pass here".
  const counts = new Uint32Array(stopCount + 1);
  const P = a.patRoute.length;
  for (let p = 0; p < P; p++) for (let i = a.patStopsOff[p]!; i < a.patStopsOff[p + 1]!; i++) counts[a.patStops[i]! + 1]!++;
  for (let s = 0; s < stopCount; s++) counts[s + 1]! += counts[s]!;
  const stopPatOff = counts.slice();
  const fill = counts.slice();
  const stopPat = new Float64Array(stopPatOff[stopCount]!);
  for (let p = 0; p < P; p++) {
    const first = a.patStopsOff[p]!;
    for (let i = first; i < a.patStopsOff[p + 1]!; i++) stopPat[fill[a.patStops[i]!]!++] = p * 65536 + (i - first);
  }
  return { header, ...a, stopPatOff, stopPat };
}
