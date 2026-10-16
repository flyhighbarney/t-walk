// The built-in planner: trips from the MBTA timetable this server already has,
// with no OpenTripPlanner. It's what plans trips on a small server (1 GB is
// plenty) and whenever OTP can't be reached.
//
// The route search is RAPTOR (packages/core/src/raptor.ts). Walking is the
// straight line × the detour factor, as everywhere else in T-Walk without a
// street network, so walks have no turn-by-turn steps and are drawn straight.
// Rides follow the GTFS shape and are labelled from the live store, exactly as
// OTP's are.

import {
  bestTime,
  countTransfers,
  earliestArrival,
  haversineMeters,
  journeyToTripOption,
  latestDeparture,
  localDate,
  serviceDateBase,
  transferRisk,
  tripFare,
  type DayTimetable,
  type DepartureSource,
  type FareRules,
  type Journey,
  type JourneyRequest,
  type Network,
  type Prediction,
  type TripLeg,
  type TripOption,
} from '@twalk/core';
import type { GtfsDb } from '../gtfs/db.ts';
import type { PlanRequest } from './planner.ts';

export const BUILTIN_NOTE = 'Walking times are estimates from straight-line distance, so walks have no turn-by-turn directions.';

export interface BuiltinHelpers {
  label: (x: { tripId: string; stopId: string; routeId: string }) => DepartureSource | null;
  predictions: (tripId: string) => Prediction[];
  nextGap: (leg: TripLeg) => number | null;
  historyBuffer: (leg: TripLeg) => number | null;
  fares?: { rules: FareRules; fareClass: (routeId: string) => string | null };
}

/** Up to four trips: the best one, the next two departures after it, and one with fewer changes. */
export async function planBuiltin(db: GtfsDb, req: PlanRequest, now: number, h: BuiltinHelpers): Promise<TripOption[]> {
  const time = req.time ?? now;
  const date = localDate(time);
  const timetable = db.timetable();
  const net = timetable.network;
  const day = await timetable.day(date);
  const at = Math.round((time - serviceDateBase(date)) / 1000);
  const jr: JourneyRequest = { from: req.from, to: req.to, pace: req.pace, avoidRouteIds: req.avoidRoutes };

  const journeys: Journey[] = [];
  if (req.arriveBy) {
    const first = latestDeparture(net, day, jr, at);
    if (first) {
      journeys.push(first);
      if (first.rides > 0) {
        const earlier = latestDeparture(net, day, jr, first.arrive - 60);
        if (earlier) journeys.push(earlier);
      }
      if (first.rides > 1) {
        const fewer = latestDeparture(net, day, { ...jr, maxRides: 1 }, at);
        if (fewer) journeys.push(fewer);
      }
    }
  } else {
    let j = earliestArrival(net, day, jr, at);
    if (j) {
      journeys.push(j);
      const rides = j.rides;
      for (let i = 0; i < 2 && j && j.rides > 0; i++) {
        j = earliestArrival(net, day, jr, j.depart + 60);
        if (j) journeys.push(j);
      }
      if (rides > 1) {
        const fewer = earliestArrival(net, day, { ...jr, maxRides: 1 }, at);
        if (fewer) journeys.push(fewer);
      }
    }
  }

  const seen = new Set<string>();
  const options: TripOption[] = [];
  for (const j of journeys) {
    const key = j.legs.map((l) => (l.kind === 'ride' ? day.header.tripIds[l.trip] : 'walk')).join('>');
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(enrich(db, net, day, j, jr, req, h));
  }
  return options;
}

function enrich(db: GtfsDb, net: Network, day: DayTimetable, j: Journey, jr: JourneyRequest, req: PlanRequest, h: BuiltinHelpers): TripOption {
  const option = journeyToTripOption(net, day, j, jr);
  option.legs = option.legs.map((leg, i) => {
    const step = j.legs[i]!;
    if (step.kind === 'walk') {
      return { ...leg, geometry: [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]], steps: [`Walk to ${leg.to.name}`] };
    }
    const first = day.patStopsOff[step.pattern]!;
    const between = Array.from({ length: Math.max(0, step.alightPos - step.boardPos - 1) }, (_, k) => day.patStops[first + step.boardPos + 1 + k]!);
    const rideStops = between.map((s) => ({ name: net.header.stopNames[s]!, stopId: net.header.stopIds[s]!, lat: net.lat[s]!, lon: net.lon[s]! }));
    const stopLine: [number, number][] = [leg.from, ...rideStops, leg.to].map((p) => [p.lon, p.lat]);
    const geometry = shapeBetween(db, leg.tripId!, leg.from, leg.to) ?? stopLine;
    const source = h.label({ tripId: leg.tripId!, stopId: leg.from.stopId!, routeId: leg.routeId! }) ?? 'scheduled';
    const preds = source === 'live' || source === 'estimate' ? h.predictions(leg.tripId!) : [];
    const board = preds.find((p) => p.stopId === leg.from.stopId);
    const alight = preds.find((p) => p.stopId === leg.to.stopId);
    return {
      ...leg,
      source,
      start: { scheduled: leg.start.scheduled, estimated: board?.departureTime ?? board?.arrivalTime ?? null },
      end: { scheduled: leg.end.scheduled, estimated: alight?.arrivalTime ?? alight?.departureTime ?? null },
      geometry,
      distanceM: Math.round(lineLength(geometry)),
      rideStops,
    };
  });
  const legs = option.legs;
  const transit = legs.filter((l) => l.transit);
  return {
    ...option,
    id: `${option.start}-${transit.map((l) => l.tripId).join('-') || 'walk'}`,
    legs: nameEnds(legs, req),
    transfers: countTransfers(legs),
    risk: transferRisk(
      legs,
      (i) => h.nextGap(legs[i]!),
      (i) => h.historyBuffer(legs[i]!),
    ),
    fare: h.fares
      ? tripFare(
          transit.map((l) => ({ fareClass: l.routeId ? h.fares!.fareClass(l.routeId) : null, priceCents: null, start: bestTime(l.start) })),
          h.fares.rules,
        )
      : null,
    stepFree: false,
  };
}

function nameEnds(legs: TripLeg[], req: PlanRequest): TripLeg[] {
  const first = legs[0];
  const last = legs[legs.length - 1];
  if (first && !first.from.stopId && req.from.name) first.from = { ...first.from, name: req.from.name };
  if (last && !last.to.stopId && req.to.name) last.to = { ...last.to, name: req.to.name };
  return legs;
}

/** The trip's GTFS shape cut to the stretch between two stops, or null without a shape. */
function shapeBetween(db: GtfsDb, tripId: string, from: { lat: number; lon: number }, to: { lat: number; lon: number }): [number, number][] | null {
  const id = db.tripShapeId(tripId);
  const coords = id ? db.shapeCoords(id) : [];
  if (coords.length < 2) return null;
  const nearest = (p: { lat: number; lon: number }, startAt: number) => {
    let best = startAt;
    let bestM = Infinity;
    for (let i = startAt; i < coords.length; i++) {
      const m = haversineMeters(p.lat, p.lon, coords[i]![1], coords[i]![0]);
      if (m < bestM) {
        bestM = m;
        best = i;
      }
    }
    return best;
  };
  const a = nearest(from, 0);
  const b = nearest(to, a);
  if (b <= a) return null;
  return [[from.lon, from.lat], ...coords.slice(a + 1, b), [to.lon, to.lat]];
}

function lineLength(line: [number, number][]): number {
  let m = 0;
  for (let i = 1; i < line.length; i++) m += haversineMeters(line[i - 1]![1], line[i - 1]![0], line[i]![1], line[i]![0]);
  return m;
}
