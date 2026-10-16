// Navigation along a planned trip: which leg you're on, what to do next, how
// many stops are left, and when you'll get there. Pure functions; the app
// feeds them GPS fixes and the live state of the vehicle you're riding.
//
// Honesty rules, as everywhere in T-Walk:
//   - "Stops left" comes from the vehicle's live position or yours, never from
//     elapsed time. With neither, it isn't shown.
//   - Underground there's usually no GPS. If you've said you're on board (or
//     we saw you leave with the vehicle), the vehicle's reports stand in for you.
//   - A fix older than FIX_STALE_MS, or vaguer than ACCURACY_LIMIT_M, doesn't move
//     you along a walk.

import { prepareShape, snapToShape, type PreparedShape } from './geo.ts';
import { haversineMeters } from './walking.ts';
import { bestTime, type TripLeg, type TripOption } from './trip.ts';

export interface NavFix {
  lat: number;
  lon: number;
  /** Metres (68% radius). */
  accuracy: number;
  /** Epoch ms of the fix. */
  at: number;
}

/** The live state of the vehicle on the current ride, from /api/trips/:tripId/live. */
export interface RideLive {
  vehicle: { lat: number; lon: number; stopId: string | null; currentStatus: 'INCOMING_AT' | 'STOPPED_AT' | 'IN_TRANSIT_TO' | null; updatedAt: number } | null;
  /** Its remaining stops, in order, with predicted times. */
  stops: { stopId: string; name: string; arrivalTime: number | null; departureTime: number | null }[];
}

export interface NavProgress {
  legIndex: number;
  /** You've said you're on the vehicle, or we saw it leave with you. */
  onBoard: boolean;
  arrived: boolean;
}

export type NavPhase = 'walk' | 'wait' | 'ride' | 'arrived';
export type Maneuver = 'depart' | 'straight' | 'left' | 'right' | 'slight-left' | 'slight-right' | 'uturn' | 'enter' | 'exit' | 'elevator' | 'board' | 'ride' | 'alight' | 'arrive';

export interface NavState {
  phase: NavPhase;
  legIndex: number;
  maneuver: Maneuver;
  /** The instruction, in a few words ("Turn left on Tremont St"). */
  primary: string;
  /** Context under it ("Then walk to Park Street"). */
  secondary: string | null;
  /** Metres to the maneuver, when it is a place ahead of you. */
  distanceM: number | null;
  /** Rides: stops until yours, counting yours. Null when we can't tell honestly. */
  stopsLeft: number | null;
  /** 'next': your stop is next; 'now': get off here. */
  alight: 'none' | 'next' | 'now';
  /** Waits: when it leaves, and how sure that is. */
  departsAt: number | null;
  /** Waits: 0 when the vehicle is at your stop, 1 when yours is its next, and so on. */
  vehicleStopsAway: number | null;
  /** Expected arrival at the destination, epoch ms. */
  eta: number;
  /** Metres still to go along the route. */
  remainingM: number;
  /** You're well off the walking route. */
  offRoute: boolean;
  /** At this pace you'd reach the stop after the vehicle has gone. */
  late: boolean;
  /** Where "you" are on the map, and what that came from. */
  position: { lat: number; lon: number; source: 'gps' | 'vehicle' } | null;
}

export const FIX_STALE_MS = 45_000;
export const ACCURACY_LIMIT_M = 80;
/** Within this of a walk's end (plus GPS accuracy), that walk is done. */
const ARRIVE_M = 25;
const OFF_ROUTE_M = 45;

const shapes = new WeakMap<TripLeg, PreparedShape>();
function shapeOf(leg: TripLeg): PreparedShape | null {
  if (leg.geometry.length < 2) return null;
  let s = shapes.get(leg);
  if (!s) {
    s = prepareShape(leg.geometry);
    shapes.set(leg, s);
  }
  return s;
}

const usable = (fix: NavFix | null, now: number): fix is NavFix => fix != null && now - fix.at <= FIX_STALE_MS && fix.accuracy <= ACCURACY_LIMIT_M;

function maneuverOf(text: string): Maneuver {
  if (/^Turn around/.test(text)) return 'uturn';
  if (/^Bear left/.test(text)) return 'slight-left';
  if (/^Bear right/.test(text)) return 'slight-right';
  if (/left/.test(text)) return 'left';
  if (/right/.test(text)) return 'right';
  if (/^Enter/.test(text)) return 'enter';
  if (/^Leave the station/.test(text)) return 'exit';
  if (/elevator/i.test(text)) return 'elevator';
  if (/^Head/.test(text)) return 'depart';
  return 'straight';
}

const sameStop = (a: string | null | undefined, b: string | null | undefined) => a != null && b != null && a === b;

/** Remaining stops the vehicle will still call at, dropping the one it's stopped at. */
function upcoming(live: RideLive): RideLive['stops'] {
  const v = live.vehicle;
  if (v?.currentStatus === 'STOPPED_AT' && sameStop(live.stops[0]?.stopId, v.stopId)) return live.stops.slice(1);
  return live.stops;
}

/** Stops until `stopId`, counting it (1 = it's the next one). Null if it isn't ahead. */
export function stopsUntil(live: RideLive, stopId: string | null): number | null {
  if (!stopId) return null;
  const i = upcoming(live).findIndex((s) => s.stopId === stopId);
  return i === -1 ? null : i + 1;
}

/** Ride stops left from where you are on the line (GPS above ground, or the vehicle's report). */
function stopsLeftByPosition(leg: TripLeg, at: { lat: number; lon: number }): number | null {
  const shape = shapeOf(leg);
  if (!shape || !leg.rideStops) return null;
  const me = snapToShape(shape, at.lon, at.lat);
  if (!me || me.offset > 150) return null;
  const along = [...leg.rideStops.map((s) => snapToShape(shape, s.lon, s.lat)?.distance ?? Infinity), shape.length];
  return along.filter((d) => d > me.distance + 30).length;
}

/** Seconds to walk what's left of walking legs from `from` on, plus the rest of the current walk. */
function walkRestS(legs: readonly TripLeg[], from: number): number {
  return legs.slice(from).reduce((a, l) => a + (l.transit ? 0 : l.durationS), 0);
}

export function navigate(input: {
  option: TripOption;
  progress: NavProgress;
  fix: NavFix | null;
  /** Live state of the current transit leg's vehicle, if it's a ride or a wait. */
  live: RideLive | null;
  now: number;
  /** Your walking speed, m/s. */
  speed: number;
}): { state: NavState; progress: NavProgress } {
  const { option, fix, live, now, speed } = input;
  const legs = option.legs;
  let progress = { ...input.progress };
  const gps = usable(fix, now) ? fix : null;

  // Move forward through legs as far as the evidence allows (one call can finish a walk and start a wait).
  for (let guard = 0; guard < legs.length && !progress.arrived; guard++) {
    const leg = legs[progress.legIndex]!;
    let done = false;
    if (!leg.transit) {
      done = gps != null && haversineMeters(gps.lat, gps.lon, leg.to.lat, leg.to.lon) <= ARRIVE_M + Math.min(gps.accuracy, 40);
    } else {
      const left = live ? stopsUntil(live, leg.to.stopId) : null;
      const v = live?.vehicle;
      const atAlight = v != null && sameStop(v.stopId, leg.to.stopId) && v.currentStatus === 'STOPPED_AT';
      const passedAlight = live != null && progress.onBoard && left == null && live.stops.length > 0 && !atAlight;
      const gpsAtAlight = gps != null && progress.onBoard && haversineMeters(gps.lat, gps.lon, leg.to.lat, leg.to.lon) <= 60 + Math.min(gps.accuracy, 40);
      // Seen leaving with the vehicle: GPS moving along the line, away from the boarding stop.
      if (!progress.onBoard && gps && now >= bestTime(leg.start) - 30_000) {
        const shape = shapeOf(leg);
        const snap = shape ? snapToShape(shape, gps.lon, gps.lat) : null;
        if (snap && snap.offset < 60 && snap.distance > 250) progress = { ...progress, onBoard: true };
      }
      done = (progress.onBoard && (passedAlight || gpsAtAlight)) || (atAlight && gpsAtAlight);
    }
    if (!done) break;
    if (progress.legIndex === legs.length - 1) progress = { ...progress, arrived: true };
    else progress = { legIndex: progress.legIndex + 1, onBoard: false, arrived: false };
  }

  const last = legs[legs.length - 1]!;
  if (progress.arrived) {
    return {
      progress,
      state: base({ phase: 'arrived', legIndex: legs.length - 1, maneuver: 'arrive', primary: `You've arrived`, secondary: last.to.name, eta: now, remainingM: 0, position: gps ? { lat: gps.lat, lon: gps.lon, source: 'gps' } : null }),
    };
  }

  const i = progress.legIndex;
  const leg = legs[i]!;
  const next = legs[i + 1];
  const lastTransit = [...legs.keys()].filter((k) => legs[k]!.transit).pop();
  const restAfter = (k: number) => legs.slice(k + 1).reduce((a, l) => a + l.distanceM, 0);

  // ── Walking ─────────────────────────────────────────────────────────────
  if (!leg.transit) {
    const shape = shapeOf(leg);
    const snap = gps && shape ? snapToShape(shape, gps.lon, gps.lat) : null;
    const done = snap ? snap.distance : 0;
    const legLeft = shape ? Math.max(0, shape.length - done) : leg.distanceM;
    const offRoute = snap != null && snap.offset > Math.max(OFF_ROUTE_M, (gps?.accuracy ?? 0) * 1.5);
    // The next turn ahead of you.
    let maneuver: Maneuver = 'straight';
    let primary = `Walk to ${leg.to.name}`;
    let distanceM: number | null = gps ? legLeft : leg.distanceM;
    if (shape && leg.stepPoints?.length) {
      const ahead = leg.stepPoints
        .map((s) => ({ s, at: snapToShape(shape, s.lon, s.lat)?.distance ?? 0 }))
        .find((x) => x.at > done + 8 && !/^Head|^Continue/.test(x.s.text));
      if (ahead) {
        maneuver = maneuverOf(ahead.s.text);
        primary = ahead.s.text;
        distanceM = Math.max(0, ahead.at - done);
      } else if (!gps && leg.stepPoints[0]) {
        maneuver = 'depart';
        primary = leg.stepPoints[0].text;
      }
    }
    const walkLeftS = legLeft / speed;
    let eta: number;
    let late = false;
    if (next?.transit) {
      const departs = departureOf(next, live);
      late = now + walkLeftS * 1000 > departs;
      eta = lastTransit != null ? arrivalOf(legs[lastTransit]!, i + 1 === lastTransit ? live : null) + walkRestS(legs, lastTransit + 1) * 1000 : option.end;
    } else {
      eta = now + (walkLeftS + walkRestS(legs, i + 1)) * 1000;
    }
    const secondary = next?.transit
      ? `Then ${lineTitle(next)}${next.headsign ? ` toward ${next.headsign}` : ''}`
      : i === legs.length - 1
        ? `to ${leg.to.name}`
        : null;
    return {
      progress,
      state: base({
        phase: 'walk',
        legIndex: i,
        maneuver,
        primary: offRoute ? `Head back toward the route` : primary,
        secondary: offRoute ? `You're about ${Math.round(snap!.offset / 10) * 10} m away from it` : secondary,
        distanceM: offRoute ? null : distanceM,
        eta,
        remainingM: legLeft + restAfter(i),
        offRoute,
        late,
        position: gps ? { lat: gps.lat, lon: gps.lon, source: 'gps' } : null,
      }),
    };
  }

  // ── Waiting, or riding ───────────────────────────────────────────────────
  const toward = leg.headsign ? ` toward ${leg.headsign}` : '';
  const L = lastTransit ?? i;
  const eta = arrivalOf(legs[L]!, L === i ? live : null) + walkRestS(legs, L + 1) * 1000;
  const vehicle = live?.vehicle ?? null;
  const vehicleFresh = vehicle != null && now - vehicle.updatedAt < 120_000;

  if (!progress.onBoard) {
    const departsAt = departureOf(leg, live);
    const atStop = vehicle != null && vehicle.currentStatus === 'STOPPED_AT' && sameStop(vehicle.stopId, leg.from.stopId);
    const away = atStop ? 0 : live ? stopsUntil(live, leg.from.stopId) : null;
    return {
      progress,
      state: base({
        phase: 'wait',
        legIndex: i,
        maneuver: 'board',
        primary: `Board ${lineTitle(leg)}${toward}`,
        secondary: `${leg.from.platform ? `Platform ${leg.from.platform} · ` : ''}get off at ${leg.to.name}`,
        departsAt,
        vehicleStopsAway: away,
        eta,
        remainingM: leg.distanceM + restAfter(i),
        position: gps ? { lat: gps.lat, lon: gps.lon, source: 'gps' } : null,
      }),
    };
  }

  // On board. Prefer the vehicle's own reports for where "you" are (no GPS underground).
  const position = vehicleFresh && (!gps || gps.accuracy > 40) ? { lat: vehicle.lat, lon: vehicle.lon, source: 'vehicle' as const } : gps ? { lat: gps.lat, lon: gps.lon, source: 'gps' as const } : vehicleFresh ? { lat: vehicle.lat, lon: vehicle.lon, source: 'vehicle' as const } : null;
  let stopsLeft = live && vehicleFresh ? stopsUntil(live, leg.to.stopId) : null;
  if (stopsLeft == null && position) stopsLeft = stopsLeftByPosition(leg, position);
  const atAlight = vehicle != null && sameStop(vehicle.stopId, leg.to.stopId) && (vehicle.currentStatus === 'STOPPED_AT' || vehicle.currentStatus === 'INCOMING_AT');
  const alight: NavState['alight'] = atAlight ? 'now' : stopsLeft === 1 ? 'next' : 'none';
  const after = next && !next.transit && legs[i + 2]?.transit ? ` and change to ${lineTitle(legs[i + 2]!)}` : next?.transit ? ` and change to ${lineTitle(next)}` : '';
  const primary =
    alight === 'now' ? `Get off at ${leg.to.name}` : alight === 'next' ? `Your stop is next: ${leg.to.name}` : stopsLeft != null ? `Get off in ${stopsLeft} stop${stopsLeft === 1 ? '' : 's'}` : `Ride to ${leg.to.name}`;
  const shape = shapeOf(leg);
  const along = position && shape ? snapToShape(shape, position.lon, position.lat) : null;
  return {
    progress,
    state: base({
      phase: 'ride',
      legIndex: i,
      maneuver: alight === 'none' ? 'ride' : 'alight',
      primary,
      secondary: alight === 'none' ? `${leg.to.name}${after}` : after ? `Then${after.replace(' and', '')}` : next ? `Then walk to ${next.to.name}` : null,
      stopsLeft,
      alight,
      eta,
      remainingM: (along && along.offset < 150 && shape ? shape.length - along.distance : leg.distanceM) + restAfter(i),
      position,
    }),
  };
}

/** "the Red Line", "the 1 bus", "the Providence/Stoughton Line train". */
export function lineTitle(leg: TripLeg): string {
  if (leg.mode === 'BUS') return `the ${leg.routeLabel ?? ''} bus`.replace('  ', ' ');
  if (leg.mode === 'RAIL') return `the ${leg.routeName ?? leg.routeLabel ?? 'Commuter Rail'} train`;
  if (leg.mode === 'FERRY') return 'the ferry';
  return `the ${leg.routeName ?? leg.routeLabel ?? 'train'}`;
}

function base(s: Partial<NavState> & Pick<NavState, 'phase' | 'legIndex' | 'maneuver' | 'primary' | 'eta' | 'remainingM'>): NavState {
  return { secondary: null, distanceM: null, stopsLeft: null, alight: 'none', departsAt: null, vehicleStopsAway: null, offRoute: false, late: false, position: null, ...s };
}

/** When this ride leaves its first stop: the live prediction if we have one. */
function departureOf(leg: TripLeg, live: RideLive | null): number {
  const s = live?.stops.find((x) => x.stopId === leg.from.stopId);
  return s?.departureTime ?? s?.arrivalTime ?? bestTime(leg.start);
}

/** When this ride reaches your stop: the live prediction if we have one. */
function arrivalOf(leg: TripLeg, live: RideLive | null): number {
  const s = live?.stops.find((x) => x.stopId === leg.to.stopId);
  return s?.arrivalTime ?? s?.departureTime ?? bestTime(leg.end);
}

// ── Learning your walking pace ─────────────────────────────────────────────

/**
 * Your walking speed from fixes taken while navigating a walk, m/s, or null
 * until there's enough (400 m of good fixes). Pauses (lights, crowds) count:
 * they're part of how long a walk really takes. Running, riding or GPS jumps
 * (over 2.6 m/s between fixes) don't.
 */
export function learnedSpeed(fixes: readonly NavFix[]): number | null {
  let dist = 0;
  let time = 0;
  for (let k = 1; k < fixes.length; k++) {
    const a = fixes[k - 1]!;
    const b = fixes[k]!;
    const dt = (b.at - a.at) / 1000;
    if (dt <= 0 || dt > 60 || a.accuracy > 25 || b.accuracy > 25) continue;
    const d = haversineMeters(a.lat, a.lon, b.lat, b.lon);
    if (d / dt > 2.6) continue;
    dist += d;
    time += dt;
  }
  return dist >= 400 && time > 0 ? dist / time : null;
}

/** Blend a new walk into what was learned before (newer walks count more). */
export function blendSpeed(previous: number | null, latest: number): number {
  return previous == null ? latest : previous * 0.7 + latest * 0.3;
}
