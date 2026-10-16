// Door-to-door trip times on the phone, from the compact timetable (timetable.ts).
//
// RAPTOR (Delling, Pajor, Werneck, "Round-Based Public Transit Routing", 2012):
// round k finds the earliest arrival at every stop using k rides. Each round
// scans the patterns through the stops improved in the round before, then lets
// people walk to nearby stops. Walking to the first stop and from the last one
// is the straight line × the detour factor (walking.ts), like the rest of T-Walk.
//
// "Arrive by" is answered by searching departure times: arrival never gets
// earlier by leaving later, so the latest departure that still arrives in time
// is found by bisection over whole minutes.

import { estimateWalk, haversineMeters, STATION_ENTRY_SECONDS, WALK_SPEED, DETOUR_FACTOR, type WalkPace } from './walking.ts';
import { NO_ALIGHT, NO_BOARD, stopsNear, type DayTimetable, type Network } from './timetable.ts';
import { gtfsSecondsToInstant } from './time.ts';
import type { TripLeg, TripMode, TripOption } from './trip.ts';

export interface PlacePoint {
  lat: number;
  lon: number;
  name?: string;
}

export interface JourneyRequest {
  from: PlacePoint;
  to: PlacePoint;
  pace?: WalkPace;
  /** Most rides in one trip. */
  maxRides?: number;
  /** Furthest walk to the first stop or from the last one, straight line. */
  accessMeters?: number;
  /** Lines to stay off (GTFS route ids): backup plans around a disruption. */
  avoidRouteIds?: readonly string[];
}

export type JourneyLeg =
  | { kind: 'walk'; from: number | 'origin'; to: number | 'destination'; seconds: number; meters: number; start: number; end: number }
  | { kind: 'ride'; pattern: number; trip: number; boardPos: number; alightPos: number; board: number; alight: number; start: number; end: number };

export interface Journey {
  /** Seconds from the service date's zero point. */
  depart: number;
  arrive: number;
  rides: number;
  legs: JourneyLeg[];
}

const INF = 0x7fffffff;
/** Time to change vehicles at the same stop. */
export const TRANSFER_SLACK_S = 60;
export const DEFAULT_ACCESS_METERS = 1200;
export const DEFAULT_MAX_RIDES = 3;

const WALK = 1;
const RIDE = 2;
const ACCESS = 3;

interface Endpoints {
  access: { stop: number; seconds: number; meters: number }[];
  egress: Map<number, { seconds: number; meters: number }>;
  direct: { seconds: number; meters: number };
}

function endpoints(net: Network, req: JourneyRequest): Endpoints {
  const pace = req.pace ?? 'normal';
  const radius = req.accessMeters ?? DEFAULT_ACCESS_METERS;
  // Getting into a station (to its platform) takes a minute more than reaching the street outside.
  const walk = (m: number, s: number) => estimateWalk(m, pace, net.parent[s]! >= 0 ? STATION_ENTRY_SECONDS : 0);
  const access = stopsNear(net, req.from.lat, req.from.lon, radius).map(({ stop, meters }) => {
    const w = walk(meters, stop);
    return { stop, seconds: Math.round(w.seconds), meters: w.meters };
  });
  const egress = new Map<number, { seconds: number; meters: number }>();
  for (const { stop, meters } of stopsNear(net, req.to.lat, req.to.lon, radius)) {
    const w = walk(meters, stop);
    egress.set(stop, { seconds: Math.round(w.seconds), meters: w.meters });
  }
  const d = estimateWalk(haversineMeters(req.from.lat, req.from.lon, req.to.lat, req.to.lon), pace);
  return { access, egress, direct: { seconds: Math.round(d.seconds), meters: d.meters } };
}

const depAt = (day: DayTimetable, t: number, pos: number) => day.tripStart[t]! + day.times[day.tripTimesOff[t]! + pos * 2 + 1]!;
const arrAt = (day: DayTimetable, t: number, pos: number) => day.tripStart[t]! + day.times[day.tripTimesOff[t]! + pos * 2]!;

/** The first trip of pattern p leaving position pos at or after `time`, or -1. Trips in a pattern never overtake. */
function firstTripFrom(day: DayTimetable, p: number, pos: number, time: number): number {
  let lo = day.patTripsOff[p]!;
  let hi = day.patTripsOff[p + 1]!;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (depAt(day, mid, pos) < time) lo = mid + 1;
    else hi = mid;
  }
  return lo < day.patTripsOff[p + 1]! ? lo : -1;
}

/** Earliest arrival leaving `depart` (seconds from the day's zero point), or null if nothing gets there. */
export function earliestArrival(net: Network, day: DayTimetable, req: JourneyRequest, depart: number, ends = endpoints(net, req)): Journey | null {
  const S = net.lat.length;
  const rounds = (req.maxRides ?? DEFAULT_MAX_RIDES) + 1;
  const label: Int32Array[] = [];
  const kind: Uint8Array[] = [];
  const from: Int32Array[] = []; // walk: previous stop; ride: trip
  const pat: Int32Array[] = []; // ride: pattern * 65536 + boarding position
  const alightPos: Int32Array[] = [];
  for (let k = 0; k < rounds; k++) {
    label.push(new Int32Array(S).fill(INF));
    kind.push(new Uint8Array(S));
    from.push(new Int32Array(S).fill(-1));
    pat.push(new Int32Array(S).fill(-1));
    alightPos.push(new Int32Array(S).fill(-1));
  }
  const best = new Int32Array(S).fill(INF);
  let marked = new Set<number>();
  for (const a of ends.access) {
    const t = depart + a.seconds;
    if (t < label[0]![a.stop]!) {
      label[0]![a.stop] = t;
      best[a.stop] = t;
      kind[0]![a.stop] = ACCESS;
      marked.add(a.stop);
    }
  }
  // Best arrival at the destination so far (target pruning).
  let target = depart + ends.direct.seconds;
  const reach = (k: number, s: number) => {
    const e = ends.egress.get(s);
    if (e && label[k]![s]! + e.seconds < target) target = label[k]![s]! + e.seconds;
  };
  for (const s of marked) reach(0, s);

  const avoid = req.avoidRouteIds?.length ? new Set(req.avoidRouteIds) : null;
  for (let k = 1; k < rounds && marked.size > 0; k++) {
    // Patterns to scan, from the earliest marked stop on each.
    const queue = new Map<number, number>();
    for (const s of marked) {
      for (let i = day.stopPatOff[s]!; i < day.stopPatOff[s + 1]!; i++) {
        const v = day.stopPat[i]!;
        const p = Math.floor(v / 65536);
        const pos = v - p * 65536;
        if (avoid?.has(net.header.routes[day.patRoute[p]!]!.id)) continue;
        const q = queue.get(p);
        if (q == null || pos < q) queue.set(p, pos);
      }
    }
    const improved = new Set<number>();
    const prev = label[k - 1]!;
    for (const [p, startPos] of queue) {
      const first = day.patStopsOff[p]!;
      const n = day.patStopsOff[p + 1]! - first;
      let trip = -1;
      let boardPos = -1;
      for (let pos = startPos; pos < n; pos++) {
        const s = day.patStops[first + pos]!;
        const flags = day.patFlags[first + pos]!;
        if (trip >= 0 && !(flags & NO_ALIGHT)) {
          const arr = arrAt(day, trip, pos);
          if (arr < best[s]! && arr < target) {
            label[k]![s] = arr;
            best[s] = arr;
            kind[k]![s] = RIDE;
            from[k]![s] = trip;
            pat[k]![s] = p * 65536 + boardPos;
            alightPos[k]![s] = pos;
            improved.add(s);
          }
        }
        if (!(flags & NO_BOARD) && prev[s]! < INF) {
          const ready = prev[s]! + (kind[k - 1]![s] === RIDE ? TRANSFER_SLACK_S : 0);
          if (trip < 0 || ready <= depAt(day, trip, pos)) {
            const t = firstTripFrom(day, p, pos, ready);
            if (t >= 0 && (trip < 0 || depAt(day, t, pos) < depAt(day, trip, pos))) {
              trip = t;
              boardPos = pos;
            }
          }
        }
      }
    }
    // Walk on from the stops reached by riding.
    const next = new Set(improved);
    const pace = req.pace ?? 'normal';
    for (const s of improved) {
      for (let i = net.fpOffsets[s]!; i < net.fpOffsets[s + 1]!; i++) {
        const n = net.fpTo[i]!;
        const t = label[k]![s]! + Math.max(net.fpMinS[i]!, Math.round(net.fpMeters[i]! / WALK_SPEED[pace]));
        // A stop just reached by riding keeps that label: walks from it already used it.
        if (t < best[n]! && t < target && !improved.has(n)) {
          label[k]![n] = t;
          best[n] = t;
          kind[k]![n] = WALK;
          from[k]![n] = s;
          next.add(n);
        }
      }
    }
    for (const s of next) reach(k, s);
    marked = next;
  }

  // The best finish: fewest rides wins a tie.
  let bestArrive = depart + ends.direct.seconds;
  let bestK = -1;
  let bestStop = -1;
  for (let k = 1; k < rounds; k++) {
    for (const [s, e] of ends.egress) {
      const t = label[k]![s]!;
      if (t < INF && t + e.seconds < bestArrive) {
        bestArrive = t + e.seconds;
        bestK = k;
        bestStop = s;
      }
    }
  }
  if (bestK < 0) {
    // Walking the whole way is as quick as anything: say so.
    const d = ends.direct;
    return { depart, arrive: depart + d.seconds, rides: 0, legs: [{ kind: 'walk', from: 'origin', to: 'destination', seconds: d.seconds, meters: d.meters, start: depart, end: depart + d.seconds }] };
  }

  // Walk back through the labels.
  const legs: JourneyLeg[] = [];
  const e = ends.egress.get(bestStop)!;
  legs.push({ kind: 'walk', from: bestStop, to: 'destination', seconds: e.seconds, meters: e.meters, start: label[bestK]![bestStop]!, end: bestArrive });
  let k = bestK;
  let s = bestStop;
  while (k >= 0) {
    const how = kind[k]![s];
    if (how === WALK) {
      const f = from[k]![s]!;
      const meters = linkMeters(net, f, s);
      legs.push({ kind: 'walk', from: f, to: s, seconds: label[k]![s]! - label[k]![f]!, meters, start: label[k]![f]!, end: label[k]![s]! });
      s = f;
    } else if (how === RIDE) {
      const trip = from[k]![s]!;
      const v = pat[k]![s]!;
      const p = Math.floor(v / 65536);
      const boardPos = v - p * 65536;
      const board = day.patStops[day.patStopsOff[p]! + boardPos]!;
      legs.push({ kind: 'ride', pattern: p, trip, boardPos, alightPos: alightPos[k]![s]!, board, alight: s, start: depAt(day, trip, boardPos), end: label[k]![s]! });
      s = board;
      k--;
    } else {
      // ACCESS, in round 0.
      const a = ends.access.find((x) => x.stop === s)!;
      legs.push({ kind: 'walk', from: 'origin', to: s, seconds: a.seconds, meters: a.meters, start: depart, end: depart + a.seconds });
      break;
    }
  }
  legs.reverse();
  // Leave as late as the first ride allows: no point standing at the stop.
  const firstRide = legs.find((l) => l.kind === 'ride');
  const access = legs[0]!;
  let leave = depart;
  if (firstRide && access.kind === 'walk' && access.from === 'origin') {
    leave = firstRide.start - access.seconds;
    access.start = leave;
    access.end = leave + access.seconds;
  }
  const rides = legs.filter((l) => l.kind === 'ride').length;
  return { depart: leave, arrive: bestArrive, rides, legs };
}

function linkMeters(net: Network, a: number, b: number): number {
  for (let i = net.fpOffsets[a]!; i < net.fpOffsets[a + 1]!; i++) if (net.fpTo[i] === b) return net.fpMeters[i]!;
  return Math.round(haversineMeters(net.lat[a]!, net.lon[a]!, net.lat[b]!, net.lon[b]!) * DETOUR_FACTOR);
}

/**
 * The latest you can leave and still arrive by `arriveBy` (seconds from the
 * day's zero point), looking back `windowS` at most. Null if nothing makes it.
 */
export function latestDeparture(net: Network, day: DayTimetable, req: JourneyRequest, arriveBy: number, windowS = 4 * 3600): Journey | null {
  const ends = endpoints(net, req);
  const walkOnly = arriveBy - ends.direct.seconds;
  let lo = Math.floor((arriveBy - windowS) / 60); // minutes; lo may fail, hi is the first that's too late
  let hi = Math.floor(arriveBy / 60) + 1;
  const fits = (m: number) => {
    const j = earliestArrival(net, day, req, m * 60, ends);
    return j && j.arrive <= arriveBy ? j : null;
  };
  let found = fits(lo);
  if (!found) return null;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const j = fits(mid);
    if (j) {
      lo = mid;
      found = j;
    } else hi = mid;
  }
  // Walking the whole way may let you leave later still.
  if (walkOnly > found.depart) {
    return { depart: walkOnly, arrive: arriveBy, rides: 0, legs: [{ kind: 'walk', from: 'origin', to: 'destination', seconds: ends.direct.seconds, meters: ends.direct.meters, start: walkOnly, end: arriveBy }] };
  }
  return found;
}

// ------------------------------------------------------------ as a TripOption

const MODE_BY_ROUTE_TYPE: Record<number, TripMode> = { 0: 'TRAM', 1: 'SUBWAY', 2: 'RAIL', 3: 'BUS', 4: 'FERRY' };

/** The journey in the shape the rest of T-Walk uses (no shapes, steps or fares). */
export function journeyToTripOption(net: Network, day: DayTimetable, j: Journey, req: JourneyRequest): TripOption {
  const date = day.header.date;
  const at = (s: number) => gtfsSecondsToInstant(date, s);
  const place = (p: number | 'origin' | 'destination') =>
    p === 'origin'
      ? { name: req.from.name ?? 'Start', lat: req.from.lat, lon: req.from.lon, stopId: null, platform: null }
      : p === 'destination'
        ? { name: req.to.name ?? 'Destination', lat: req.to.lat, lon: req.to.lon, stopId: null, platform: null }
        : { name: net.header.stopNames[p]!, lat: net.lat[p]!, lon: net.lon[p]!, stopId: net.header.stopIds[p]!, platform: null };
  const legs: TripLeg[] = j.legs.map((l) => {
    const base = { from: place(l.kind === 'ride' ? l.board : l.from), to: place(l.kind === 'ride' ? l.alight : l.to), start: { scheduled: at(l.start), estimated: null }, end: { scheduled: at(l.end), estimated: null }, geometry: [] as [number, number][], steps: [], alerts: [], priceCents: null, stayOn: false };
    if (l.kind === 'walk') {
      return { ...base, mode: 'WALK', transit: false, source: 'walk', routeId: null, routeLabel: null, routeName: null, color: null, textColor: null, headsign: null, tripId: null, distanceM: l.meters, durationS: l.end - l.start, stopsBetween: 0 };
    }
    const route = net.header.routes[day.patRoute[l.pattern]!]!;
    return {
      ...base,
      mode: MODE_BY_ROUTE_TYPE[route.routeType] ?? 'OTHER',
      transit: true,
      source: 'scheduled',
      routeId: route.id,
      routeLabel: route.label,
      routeName: route.name,
      color: route.color,
      textColor: route.textColor,
      headsign: day.header.headsigns[l.trip] || null,
      tripId: day.header.tripIds[l.trip]!,
      distanceM: 0,
      durationS: l.end - l.start,
      stopsBetween: Math.max(0, l.alightPos - l.boardPos - 1),
    };
  });
  const walks = legs.filter((l) => !l.transit);
  const rides = j.legs.filter((l) => l.kind === 'ride').length;
  return {
    id: `raptor-${date}-${j.depart}-${j.arrive}`,
    legs,
    start: at(j.depart),
    end: at(j.arrive),
    durationS: j.arrive - j.depart,
    walkS: walks.reduce((n, l) => n + l.durationS, 0),
    walkM: walks.reduce((n, l) => n + l.distanceM, 0),
    transfers: Math.max(0, rides - 1),
    risk: { level: 'none', transfers: [] },
    fare: null,
    walkOnly: rides === 0,
    stepFree: false,
    alsoAt: [],
  };
}
