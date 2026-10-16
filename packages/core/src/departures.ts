// Turns predictions, schedules and vehicles at one stop into the rows the
// rider sees, each labelled with where its time came from.
//
// Sources, most to least certain:
// - live:      a real-time prediction
// - estimate:  a prediction the MBTA marks as schedule-based (uncertainty 300,
//              bus and Commuter Rail: "Real-time prediction not available",
//              adjusted with historical travel times) — swagger, 2026-10-15
// - vehicle:   a vehicle is signed into the trip but there is no prediction here
// - scheduled: the timetable only
//
// Subway: the MBTA runs most subway trips as ADDED trips whose ids are not in
// the GTFS schedule (seen live 2026-10-15), so subway schedule rows are never
// matched to predictions or flagged as ghosts. When a subway line has no
// predictions, the group shows a headway from the schedule instead ("Every
// 8–13 min"), as the display guidelines say.

import {
  DOWN_AFTER_SECONDS,
  isSubway,
  staleAfterSeconds,
  type FeedHealth,
  type Mode,
  type Prediction,
  type RouteInfo,
  type ScheduledStopTime,
  type Vehicle,
} from './model.ts';
import { displayPrediction } from './display.ts';

export type DepartureSource = 'live' | 'estimate' | 'vehicle' | 'scheduled';

export interface DepartureRow {
  key: string;
  tripId: string;
  routeId: string;
  directionId: 0 | 1;
  headsign: string;
  source: DepartureSource;
  arrivalTime: number | null;
  departureTime: number | null;
  /** The timetable's time for this call, when the trip is in the schedule. */
  scheduledTime: number | null;
  status: string | null;
  /** Commuter Rail track, when announced. */
  track: string | null;
  vehicleId: string | null;
  vehicleStoppedHere: boolean;
  occupancy: string | null;
  canceled: boolean;
  /** Uncertainty 301: valid, but the vehicle looks stalled or badly delayed. */
  stalled: boolean;
  /** Scheduled, should be running by now, and nothing live is on it. */
  mayNotRun: boolean;
  lastTrip: boolean;
}

export interface DepartureGroup {
  routeId: string;
  directionId: 0 | 1;
  mode: Mode;
  /** The direction's name ("Southbound") and usual destination. */
  directionName: string;
  destination: string;
  rows: DepartureRow[];
  /** Subway with nothing live: "Every 8–13 min" from the schedule. */
  headway: { minMinutes: number; maxMinutes: number } | null;
  /** True when these rows come from the schedule because live data is down. */
  liveUnavailable: boolean;
  /** Age of the live data behind these rows, seconds; null for schedule-only. */
  dataAgeSeconds: number | null;
  stale: boolean;
}

export interface BuildDeparturesInput {
  now: number;
  routes: ReadonlyMap<string, RouteInfo>;
  predictions: readonly Prediction[];
  schedules: readonly ScheduledStopTime[];
  vehicles: ReadonlyMap<string, Vehicle>;
  /** Platform ids that belong to this stop (the stop itself, or a station's children). */
  stopIds: ReadonlySet<string>;
  /** stop id → platform code ("3"), for Commuter Rail tracks. */
  platformCodes?: ReadonlyMap<string, string>;
  /** Static trip headsign, for trips in the schedule. */
  tripHeadsign: (tripId: string) => string | null;
  /** Destination of a trip not in the schedule (e.g. ADDED subway trips). */
  derivedHeadsign?: (tripId: string) => string | null;
  /** Routes the live feed currently has any predictions for. */
  trackedRoutes: ReadonlySet<string>;
  /** Live-data health, per mode (the bus and rail streams fail separately). */
  health: FeedHealth | ((mode: Mode) => FeedHealth);
  /** How far ahead to look, ms. */
  horizonMs?: number;
  /** Rows kept per route and direction. */
  maxRows?: number;
}

const DEFAULT_HORIZON_MS = 90 * 60_000;
/** One more than is shown, so a row that times out on the phone leaves three. */
const DEFAULT_MAX_ROWS = 4;

/** How long after a trip should have started before "no live data" means "may not run". */
const GHOST_GRACE_MS = 3 * 60_000;
/** Only flag trips leaving this stop soon; further out there's still time for it to appear. */
const GHOST_LOOKAHEAD_MS = 20 * 60_000;

export function feedAgeSeconds(health: FeedHealth, now: number): number | null {
  return health.lastUpdateAt == null ? null : Math.max(0, (now - health.lastUpdateAt) / 1000);
}

/** Live data is usable: connected and not older than the cut-off. */
export function liveUsable(health: FeedHealth, now: number): boolean {
  const age = feedAgeSeconds(health, now);
  return health.state !== 'down' && age != null && age <= DOWN_AFTER_SECONDS;
}

/** Live, schedule-based estimate, or not to be shown, by the MBTA's uncertainty codes. */
export function sourceFor(p: Prediction, mode: Mode): DepartureSource | 'drop' {
  if (isSubway(mode)) return 'live'; // 60/120/360 on subway are all real predictions
  const u = p.departureUncertainty ?? p.arrivalUncertainty;
  if (u == null || u < 300) return 'live';
  if (u === 300) return 'estimate';
  if (u === 301) return 'live';
  return 'drop'; // > 301: "likely invalid and shouldn't be displayed"
}

const isStalled = (p: Prediction) => (p.departureUncertainty ?? p.arrivalUncertainty) === 301;

const rowTime = (r: DepartureRow) => r.arrivalTime ?? r.departureTime ?? r.scheduledTime ?? Number.POSITIVE_INFINITY;

export function buildDepartures(input: BuildDeparturesInput): DepartureGroup[] {
  const { now, routes } = input;
  const horizon = now + (input.horizonMs ?? DEFAULT_HORIZON_MS);
  const maxRows = input.maxRows ?? DEFAULT_MAX_ROWS;
  const healthOf = typeof input.health === 'function' ? input.health : () => input.health as FeedHealth;
  const usableCache = new Map<Mode, boolean>();
  const usable = (mode: Mode) => {
    let u = usableCache.get(mode);
    if (u === undefined) usableCache.set(mode, (u = liveUsable(healthOf(mode), now)));
    return u;
  };
  const age = (mode: Mode) => feedAgeSeconds(healthOf(mode), now);

  const scheduleByTrip = new Map<string, ScheduledStopTime>();
  for (const s of input.schedules) {
    if (input.stopIds.has(s.stopId)) scheduleByTrip.set(`${s.tripId}|${s.stopSequence}`, s);
  }
  const scheduleForTrip = new Map<string, ScheduledStopTime>();
  for (const s of scheduleByTrip.values()) scheduleForTrip.set(s.tripId, s);

  const groups = new Map<string, DepartureGroup>();
  const groupFor = (routeId: string, directionId: 0 | 1): DepartureGroup | null => {
    const route = routes.get(routeId);
    if (!route) return null;
    const key = `${routeId}|${directionId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        routeId,
        directionId,
        mode: route.mode,
        directionName: route.directionNames[directionId],
        destination: route.directionDestinations[directionId],
        rows: [],
        headway: null,
        liveUnavailable: !usable(route.mode),
        dataAgeSeconds: null,
        stale: false,
      };
      groups.set(key, g);
    }
    return g;
  };

  const predictedTrips = new Set<string>();

  {
    for (const p of input.predictions) {
      if (!input.stopIds.has(p.stopId) || !p.revenue) continue;
      const route = routes.get(p.routeId);
      if (!route || !usable(route.mode)) continue;
      predictedTrips.add(p.tripId);
      const source = sourceFor(p, route.mode);
      if (source === 'drop') continue;
      const canceled = p.scheduleRelationship === 'CANCELED' || p.scheduleRelationship === 'SKIPPED';
      const sched = scheduleByTrip.get(`${p.tripId}|${p.stopSequence}`) ?? scheduleForTrip.get(p.tripId) ?? null;
      const scheduledTime = sched ? (sched.departureTime ?? sched.arrivalTime) : null;
      if (!canceled && p.departureTime == null) continue; // can't board here
      const when = canceled ? scheduledTime : (p.arrivalTime ?? p.departureTime);
      if (when == null || when > horizon) continue;
      if (canceled && when < now) continue;
      const vehicle = p.vehicleId ? input.vehicles.get(p.vehicleId) : undefined;
      const vehicleStoppedHere =
        vehicle != null && vehicle.currentStatus === 'STOPPED_AT' && vehicle.stopId != null && input.stopIds.has(vehicle.stopId);
      // Already gone by the display rules (e.g. a train that has left): not a departure.
      if (
        !canceled &&
        displayPrediction({ mode: route.mode, now, arrivalTime: p.arrivalTime, departureTime: p.departureTime, status: p.status, vehicleStoppedHere }).kind === 'hidden'
      ) {
        continue;
      }
      const g = groupFor(p.routeId, p.directionId);
      if (!g) continue;
      g.rows.push({
        key: `${p.tripId}|${p.stopSequence}`,
        tripId: p.tripId,
        routeId: p.routeId,
        directionId: p.directionId,
        headsign:
          p.headsign ??
          input.tripHeadsign(p.tripId) ??
          input.derivedHeadsign?.(p.tripId) ??
          route.directionDestinations[p.directionId],
        source,
        arrivalTime: canceled ? null : p.arrivalTime,
        departureTime: canceled ? null : p.departureTime,
        scheduledTime,
        status: p.status,
        // Platform codes are tracks only on Commuter Rail (Green Line platforms are lettered B/C/D/E).
        track: route.mode === 'commuter_rail' ? (input.platformCodes?.get(p.stopId) ?? null) : null,
        vehicleId: p.vehicleId,
        vehicleStoppedHere,
        occupancy: vehicle?.occupancy ?? null,
        canceled,
        stalled: isStalled(p),
        mayNotRun: false,
        lastTrip: p.lastTrip,
      });
    }
  }

  const vehicleByTrip = new Map<string, Vehicle>();
  for (const v of input.vehicles.values()) if (v.tripId) vehicleByTrip.set(v.tripId, v);

  const subwaySchedule = new Map<string, number[]>();

  for (const s of scheduleByTrip.values()) {
    const route = routes.get(s.routeId);
    if (!route) continue;
    if (s.pickupType === 1) continue; // no boarding here
    const when = s.departureTime ?? s.arrivalTime;
    if (when == null || when < now || when > horizon) continue;

    if (isSubway(route.mode)) {
      const key = `${s.routeId}|${s.directionId}`;
      const list = subwaySchedule.get(key) ?? [];
      list.push(when);
      subwaySchedule.set(key, list);
      continue;
    }
    if (predictedTrips.has(s.tripId)) continue;

    const vehicle = usable(route.mode) ? vehicleByTrip.get(s.tripId) : undefined;
    const shouldBeRunning = s.tripStartTime + GHOST_GRACE_MS < now && when - now <= GHOST_LOOKAHEAD_MS;
    const g = groupFor(s.routeId, s.directionId);
    if (!g) continue;
    g.rows.push({
      key: `${s.tripId}|${s.stopSequence}`,
      tripId: s.tripId,
      routeId: s.routeId,
      directionId: s.directionId,
      headsign: s.headsign || route.directionDestinations[s.directionId],
      source: vehicle ? 'vehicle' : 'scheduled',
      arrivalTime: null,
      departureTime: null,
      scheduledTime: when,
      status: null,
      track: null,
      vehicleId: vehicle?.id ?? null,
      vehicleStoppedHere: false,
      occupancy: vehicle?.occupancy ?? null,
      canceled: false,
      stalled: false,
      // Only when the live feed is healthy *and* is tracking this route: if we
      // can't see the route at all, silence means nothing.
      mayNotRun: usable(route.mode) && !vehicle && shouldBeRunning && input.trackedRoutes.has(s.routeId),
      lastTrip: false,
    });
  }

  // Subway: headway from the schedule when there's nothing live for that direction.
  for (const [key, times] of subwaySchedule) {
    const [routeId, dir] = key.split('|') as [string, string];
    const directionId = Number(dir) as 0 | 1;
    const existing = groups.get(key);
    if (existing && existing.rows.some((r) => r.source === 'live')) continue;
    const g = groupFor(routeId, directionId);
    if (!g) continue;
    const sorted = [...new Set(times)].sort((a, b) => a - b).filter((t) => t <= now + 60 * 60_000);
    if (sorted.length >= 2) {
      const gaps = sorted.slice(1).map((t, i) => (t - sorted[i]!) / 60_000);
      g.headway = { minMinutes: Math.min(...gaps), maxMinutes: Math.max(...gaps) };
    } else if (sorted.length === 1) {
      g.rows.push({
        key: `${routeId}|${directionId}|next`,
        tripId: '',
        routeId,
        directionId,
        headsign: routes.get(routeId)!.directionDestinations[directionId],
        source: 'scheduled',
        arrivalTime: null,
        departureTime: null,
        scheduledTime: sorted[0]!,
        status: null,
        track: null,
        vehicleId: null,
        vehicleStoppedHere: false,
        occupancy: null,
        canceled: false,
        stalled: false,
        mayNotRun: false,
        lastTrip: false,
      });
    }
  }

  const result = [...groups.values()];
  for (const g of result) {
    g.rows.sort((a, b) => rowTime(a) - rowTime(b));
    g.rows = g.rows.slice(0, maxRows);
    const hasLive = g.rows.some((r) => r.source === 'live' || r.source === 'estimate' || r.source === 'vehicle');
    g.dataAgeSeconds = usable(g.mode) && hasLive ? age(g.mode) : null;
    g.stale = g.dataAgeSeconds != null && g.dataAgeSeconds > staleAfterSeconds(g.mode);
  }
  return result
    .filter((g) => g.rows.length > 0 || g.headway != null)
    .sort((a, b) => {
      const ra = routes.get(a.routeId)!;
      const rb = routes.get(b.routeId)!;
      return ra.sortOrder - rb.sortOrder || a.directionId - b.directionId;
    });
}

/** The time a row is shown for and checked against for "can I make it". */
export function rowLeavesAt(row: DepartureRow): number | null {
  if (row.canceled) return null;
  return row.departureTime ?? row.arrivalTime ?? row.scheduledTime;
}
