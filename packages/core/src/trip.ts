// Trip planning: the shapes the server sends, the transfer-risk score, and
// how options are merged and sorted. Pure functions; the server fills these
// from OpenTripPlanner.
//
// Transfer risk, until there's logged history (Phase 6): for each change of
// vehicle, the spare time is the gap between arriving and the next departure
// minus the walk between them. It is compared with a buffer for how far the
// incoming arrival can still move: small for a live prediction, larger for a
// schedule-based estimate, largest for a timetable time.

import type { DepartureSource } from './departures.ts';

export type TripMode = 'WALK' | 'BUS' | 'SUBWAY' | 'TRAM' | 'RAIL' | 'FERRY' | 'BICYCLE' | 'OTHER';

export interface TripPlace {
  name: string;
  lat: number;
  lon: number;
  /** GTFS stop id (no feed prefix), for transit stops. */
  stopId: string | null;
  platform: string | null;
}

export interface TripTime {
  /** Epoch ms. */
  scheduled: number;
  /** Real-time estimate, when there is one. */
  estimated: number | null;
}

export const bestTime = (t: TripTime) => t.estimated ?? t.scheduled;

export interface TripLeg {
  mode: TripMode;
  transit: boolean;
  from: TripPlace;
  to: TripPlace;
  start: TripTime;
  end: TripTime;
  /** How sure the times are (transit legs); walks are 'walk'. */
  source: DepartureSource | 'walk';
  routeId: string | null;
  routeLabel: string | null;
  routeName: string | null;
  color: string | null;
  textColor: string | null;
  headsign: string | null;
  tripId: string | null;
  distanceM: number;
  durationS: number;
  /** [lon, lat] pairs. */
  geometry: [number, number][];
  /** Turn-by-turn for walks ("Turn left on Tremont St"). */
  steps: string[];
  /** Stops ridden through. */
  stopsBetween: number;
  alerts: string[];
  /** This ride's single fare (tap to pay), in cents, when known. */
  priceCents: number | null;
  /** The vehicle carries on as this ride (same seat, new trip number): not a transfer. */
  stayOn: boolean;
  /** Walks: each turn with where it is, for turn-by-turn navigation. */
  stepPoints?: WalkStep[];
  /** Rides: the stops passed through (not boarding or getting off), in order. */
  rideStops?: RideStop[];
}

export interface WalkStep {
  text: string;
  lat: number;
  lon: number;
  /** Metres walked on this step. */
  distanceM: number;
}

export interface RideStop {
  name: string;
  stopId: string | null;
  lat: number;
  lon: number;
}

/** Changes of vehicle: rides after the first, not counting staying on board. */
export function countTransfers(legs: readonly TripLeg[]): number {
  return Math.max(0, legs.filter((l) => l.transit && !l.stayOn).length - 1);
}

export type RiskLevel = 'none' | 'low' | 'medium' | 'high';

export interface TransferCheck {
  at: string;
  /** Seconds left over after the walk between the two. */
  spareS: number;
  /** The buffer this connection should have. */
  bufferS: number;
  walkS: number;
  /** When the next vehicle of that line leaves the same stop after this one, seconds later (from the timetable). */
  nextGapS: number | null;
  level: Exclude<RiskLevel, 'none'>;
}

export interface TransferRisk {
  level: RiskLevel;
  transfers: TransferCheck[];
}

export interface TripFare {
  /** Total in cents, or null when not every leg's fare is known. */
  cents: number | null;
  label: string;
}

export type PlanSort = 'fastest' | 'least-walking' | 'fewest-transfers' | 'most-reliable';

export interface TripOption {
  id: string;
  legs: TripLeg[];
  start: number;
  end: number;
  durationS: number;
  walkS: number;
  walkM: number;
  transfers: number;
  risk: TransferRisk;
  fare: TripFare | null;
  /** Walking all the way. */
  walkOnly: boolean;
  stepFree: boolean;
  /** Start times of the same route on later vehicles, folded into this one. */
  alsoAt: number[];
}

export interface PlanResponse {
  now: number;
  options: TripOption[];
  /** Plain-language reasons when nothing was found. */
  messages: string[];
  /** Whether live data was applied to these results. */
  live: boolean;
}

/** How far an arrival time can still move, by where it came from. */
export function arrivalBufferS(source: DepartureSource | 'walk', mode: TripMode): number {
  switch (source) {
    case 'live':
      return mode === 'BUS' ? 120 : 60;
    case 'estimate':
      return 180;
    case 'vehicle':
    case 'scheduled':
      return mode === 'BUS' ? 300 : 180;
    default:
      return 0;
  }
}

const RANK: Record<RiskLevel, number> = { none: 0, low: 1, medium: 2, high: 3 };

/** Missing a connection this frequent costs little, so it's never called risky. */
export const FREQUENT_GAP_S = 10 * 60;

/**
 * `nextGap(i)`: for the ride at legs[i], how long until the next vehicle of
 * its line leaves the same stop (seconds), if known.
 */
export function transferRisk(
  legs: readonly TripLeg[],
  nextGap: (legIndex: number) => number | null = () => null,
  /** Seconds of observed lateness to add to the buffer for the ride at legs[i], if history has any. */
  historyBuffer: (legIndex: number) => number | null = () => null,
): TransferRisk {
  const transfers: TransferCheck[] = [];
  let prev: TripLeg | null = null;
  let prevIndex = -1;
  let walkS = 0;
  legs.forEach((leg, i) => {
    if (!leg.transit) {
      if (prev) walkS += leg.durationS;
      return;
    }
    if (prev && leg.stayOn) {
      // Same vehicle carrying on: nothing to catch.
      prev = leg;
      prevIndex = i;
      walkS = 0;
      return;
    }
    if (prev) {
      const gapS = (bestTime(leg.start) - bestTime(prev.end)) / 1000;
      const spareS = gapS - walkS;
      const bufferS = arrivalBufferS(prev.source, prev.mode) + (historyBuffer(prevIndex) ?? 0);
      const nextGapS = nextGap(i);
      let level: TransferCheck['level'] = spareS >= 2 * bufferS ? 'low' : spareS >= bufferS ? 'medium' : 'high';
      if (level === 'high' && nextGapS != null && nextGapS <= FREQUENT_GAP_S) level = 'medium';
      transfers.push({ at: leg.from.name, spareS, bufferS, walkS, nextGapS, level });
    }
    prev = leg;
    prevIndex = i;
    walkS = 0;
  });
  const level = transfers.reduce<RiskLevel>((worst, t) => (RANK[t.level] > RANK[worst] ? t.level : worst), 'none');
  return { level, transfers };
}

/** "3 min to spare after a 2 min walk". */
export function describeTransfer(t: TransferCheck): string {
  const spare = Math.round(t.spareS / 60);
  const walk = Math.round(t.walkS / 60);
  const lead = spare <= 0 ? 'No time to spare' : `${spare} min to spare`;
  const base = walk > 0 ? `${lead} after a ${walk} min walk` : lead;
  return t.nextGapS != null && t.nextGapS <= FREQUENT_GAP_S && t.level !== 'low'
    ? `${base}; the next one is about ${Math.max(1, Math.round(t.nextGapS / 60))} min later`
    : base;
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  none: 'No transfers',
  low: 'Easy transfer',
  medium: 'Tight transfer',
  high: 'Risky transfer',
};

/** The same lines between the same stops: one route, whatever the time. */
export function patternSignature(o: Pick<TripOption, 'legs'>): string {
  return (
    o.legs
      .filter((l) => l.transit)
      .map((l) => `${l.routeId}:${l.from.stopId}>${l.to.stopId}`)
      .join('|') || 'walk'
  );
}

/**
 * One option per route, in the order given; later departures of the same
 * route become `alsoAt` (up to three) instead of near-identical cards.
 */
export function foldRepeats(options: readonly TripOption[]): TripOption[] {
  const out: TripOption[] = [];
  const byPattern = new Map<string, TripOption>();
  for (const o of options) {
    const key = patternSignature(o);
    const first = byPattern.get(key);
    if (!first) {
      const copy = { ...o, alsoAt: [] as number[] };
      byPattern.set(key, copy);
      out.push(copy);
    } else if (first.alsoAt.length < 3 && o.start > first.start) first.alsoAt.push(o.start);
  }
  for (const o of out) o.alsoAt.sort((a, b) => a - b);
  return out;
}

/** Same vehicles at the same times: the same option. */
export function tripSignature(o: Pick<TripOption, 'legs'>): string {
  return o.legs
    .filter((l) => l.transit)
    .map((l) => `${l.tripId ?? l.routeId}@${l.start.scheduled}`)
    .join('>') || `walk@${o.legs[0]?.start.scheduled ?? 0}`;
}

export function mergeOptions(lists: readonly TripOption[][]): TripOption[] {
  const seen = new Map<string, TripOption>();
  for (const list of lists) for (const o of list) if (!seen.has(tripSignature(o))) seen.set(tripSignature(o), o);
  return [...seen.values()];
}

export function sortOptions(options: readonly TripOption[], sort: PlanSort, arriveBy: boolean): TripOption[] {
  const byTime = (a: TripOption, b: TripOption) => (arriveBy ? b.start - a.start : a.end - b.end);
  const cmp: Record<PlanSort, (a: TripOption, b: TripOption) => number> = {
    fastest: (a, b) => byTime(a, b) || a.durationS - b.durationS,
    'least-walking': (a, b) => a.walkS - b.walkS || byTime(a, b),
    'fewest-transfers': (a, b) => a.transfers - b.transfers || byTime(a, b),
    // Least risky first; among equals, the earliest arrival.
    'most-reliable': (a, b) => RANK[a.risk.level] - RANK[b.risk.level] || byTime(a, b),
  };
  return [...options].sort(cmp[sort]);
}

/**
 * A safer option worth suggesting instead of a risky one: lower risk, and
 * arriving no more than `maxLaterMin` later.
 */
export function saferAlternative(option: TripOption, all: readonly TripOption[], maxLaterMin = 12): TripOption | null {
  if (option.risk.level !== 'high') return null;
  return (
    [...all]
      .filter((o) => o.id !== option.id && RANK[o.risk.level] < RANK.high && o.end - option.end <= maxLaterMin * 60_000)
      .sort((a, b) => a.end - b.end)[0] ?? null
  );
}

/** Google encoded polyline → [lon, lat]. */
export function decodePolyline(str: string, precision = 5): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let lat = 0;
  let lon = 0;
  let i = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let result = 0;
      let shift = 0;
      let b: number;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d;
      else lon += d;
    }
    out.push([lon / factor, lat / factor]);
  }
  return out;
}
