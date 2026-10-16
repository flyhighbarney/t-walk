// Plans a trip: asks OpenTripPlanner the same question a few ways in parallel
// (fastest, less walking, fewer transfers), merges the answers, adds walking
// the whole way when that's competitive, and labels every leg with how sure
// its times are from our own live store.

import {
  WALK_SPEED,
  foldRepeats,
  isSubway,
  mergeOptions,
  sortOptions,
  sourceFor,
  type PlanResponse,
  type FareRules,
  type PlanSort,
  type TripLeg,
  type TripOption,
  type WalkPace,
} from '@twalk/core';
import type { ArrivalHistory } from '@twalk/core';
import type { GtfsDb } from '../gtfs/db.ts';
import type { Clock } from '../live/clock.ts';
import type { Ingest } from '../live/ingest.ts';
import type { LiveStore } from '../live/store.ts';
import { mapItinerary, OtpError, queryOtp, type OtpRoutingError, type PlanQuery } from './otp.ts';

/** OTP's routing error codes (2.10 schema), in words a rider can act on. */
const ROUTING_MESSAGES: Record<string, string> = {
  NO_TRANSIT_CONNECTION_IN_SEARCH_WINDOW:
    'No trains, buses or boats found around that time. Most MBTA service stops between about 1 and 5 AM; try "Leave at" a later time.',
  NO_TRANSIT_CONNECTION: 'No transit route connects these two places.',
  OUTSIDE_SERVICE_PERIOD: "That date is outside the timetable we have. Try a date in the next few weeks.",
  OUTSIDE_BOUNDS: "One of those places is outside the area T-Walk covers.",
  LOCATION_NOT_FOUND: "One of those places couldn't be found on the street map.",
  NO_STOPS_IN_RANGE: 'There are no stops within walking distance of one of those places.',
  NO_DIRECT_MODE_CONNECTION: "There's no walking route between those places.",
};

const messageFor = (e: OtpRoutingError) => ROUTING_MESSAGES[e.code] ?? e.description;

/** With no transit, a walk this long is still worth offering. */
const MAX_FALLBACK_WALK_S = 75 * 60;

export interface PlanRequest {
  from: { lat: number; lon: number; name?: string };
  to: { lat: number; lon: number; name?: string };
  time: number | null;
  arriveBy: boolean;
  stepFree: boolean;
  pace: WalkPace;
  sort: PlanSort;
  avoidRoutes?: string[];
}

/** Walking the whole way is offered when it's no more than this much slower than riding. */
const WALK_IT_MARGIN_S = 5 * 60;
const MAX_WALK_IT_S = 40 * 60;

export class Planner {
  private readonly otpUrl: string;
  private readonly getDb: () => GtfsDb;
  private readonly store: LiveStore;
  private readonly ingest: Ingest;
  private readonly clock: Clock;
  private readonly query: typeof queryOtp;
  private readonly fareRules: FareRules | null;
  private readonly history: ArrivalHistory | null;

  constructor(opts: {
    otpUrl: string;
    getDb: () => GtfsDb;
    store: LiveStore;
    ingest: Ingest;
    clock: Clock;
    query?: typeof queryOtp;
    fareRules?: FareRules | null;
    history?: ArrivalHistory | null;
  }) {
    this.otpUrl = opts.otpUrl;
    this.getDb = opts.getDb;
    this.store = opts.store;
    this.ingest = opts.ingest;
    this.clock = opts.clock;
    this.query = opts.query ?? queryOtp;
    this.fareRules = opts.fareRules ?? null;
    this.history = opts.history ?? null;
  }

  private fares = () =>
    this.fareRules ? { rules: this.fareRules, fareClass: (routeId: string) => this.getDb().routes().get(routeId)?.fareClass ?? null } : undefined;

  private label = ({ tripId, stopId, routeId }: { tripId: string; stopId: string; routeId: string }) => {
    const route = this.getDb().routes().get(routeId);
    if (!route) return null;
    const usable = this.ingest.predictionHealth(route.mode).state !== 'down';
    if (!usable) return 'scheduled' as const;
    const p = this.store.predictionsForTrip(tripId).find((x) => x.stopId === stopId);
    if (p) {
      const s = sourceFor(p, route.mode);
      return s === 'drop' ? ('scheduled' as const) : s;
    }
    // Subway runs mostly as ADDED trips that aren't in the timetable OTP routes on,
    // so a subway leg with no matching prediction is a scheduled time, said so.
    return isSubway(route.mode) || !this.store.trackedRoutes().has(routeId) ? ('scheduled' as const) : null;
  };

  /** The timetable's next departure of the same line from the same stop, after this ride's. */
  private nextGap = (leg: TripLeg): number | null => {
    if (!leg.routeId || !leg.from.stopId) return null;
    const dep = leg.start.scheduled;
    const later = this.getDb()
      .schedules([leg.from.stopId], dep + 30_000, dep + 30 * 60_000)
      .filter((s) => s.routeId === leg.routeId && s.pickupType !== 1)
      .map((s) => s.departureTime ?? s.arrivalTime ?? Number.POSITIVE_INFINITY)
      .sort((a, b) => a - b)[0];
    return later != null && Number.isFinite(later) ? (later - dep) / 1000 : null;
  };

  /** Seconds this line has tended to run late into the stop where the ride ends, once there's enough history. */
  private historyBuffer = (leg: TripLeg): number | null =>
    this.history && leg.routeId && leg.to.stopId ? this.history.extraBufferS({ routeId: leg.routeId, stopId: leg.to.stopId }) : null;

  async plan(req: PlanRequest, signal?: AbortSignal): Promise<PlanResponse> {
    const now = this.clock.now();
    const base: Omit<PlanQuery, 'flavor'> = {
      from: req.from,
      to: req.to,
      time: req.time ?? now,
      arriveBy: req.arriveBy,
      stepFree: req.stepFree,
      walkSpeed: WALK_SPEED[req.pace],
      avoidRoutes: req.avoidRoutes,
    };
    const flavors: PlanQuery['flavor'][] = ['fastest', 'least-walking', 'fewest-transfers'];
    const results = await Promise.allSettled(flavors.map((flavor) => this.query(this.otpUrl, { ...base, flavor }, signal)));
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed.length === results.length) {
      const reason = failed[0]!.reason;
      throw reason instanceof Error ? reason : new OtpError(String(reason));
    }
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof queryOtp>>> => r.status === 'fulfilled').map((r) => r.value);
    const lists = ok.map((r) => r.itineraries.map((it) => mapItinerary(it, { label: this.label, stepFree: req.stepFree, ends: { from: req.from.name, to: req.to.name }, nextGap: this.nextGap, historyBuffer: this.historyBuffer, fares: this.fares() })));
    let options = mergeOptions(lists);

    // Walking the whole way: OTP returns it as a direct option when it's sensible; keep it only if it's competitive.
    const transit = options.filter((o) => !o.walkOnly);
    const fastest = transit.reduce<TripOption | null>((a, o) => (!a || o.durationS < a.durationS ? o : a), null);
    options = options.filter(
      (o) => !o.walkOnly || o.durationS <= MAX_WALK_IT_S || (fastest != null && o.durationS <= fastest.durationS + WALK_IT_MARGIN_S),
    );

    // Nothing to ride (late at night, say): at least offer the walk.
    let walkFallback = false;
    if (options.length === 0) {
      try {
        const walk = await this.query(this.otpUrl, { ...base, flavor: 'walk-only' }, signal);
        options = walk.itineraries
          .map((it) => mapItinerary(it, { label: this.label, stepFree: req.stepFree, ends: { from: req.from.name, to: req.to.name }, fares: this.fares() }))
          .filter((o) => o.durationS <= MAX_FALLBACK_WALK_S);
        walkFallback = options.length > 0;
      } catch {
        // The transit answer's messages still explain what happened.
      }
    }

    // OTP's notes ("no transit connection…") only matter when there was nothing to ride.
    const errors = options.length > 0 && !walkFallback ? [] : ok.flatMap((r) => r.errors).filter((e) => e.code !== 'WALKING_BETTER_THAN_TRANSIT');
    const messages = [...new Set(errors.map(messageFor))];
    if (options.length === 0 && messages.length === 0) messages.push('No trips found for that time. Try a later time or a nearby place.');
    const live = (['heavy_rail', 'bus'] as const).some((m) => this.ingest.predictionHealth(m).state !== 'down');
    return { now, options: foldRepeats(sortOptions(options, req.sort, req.arriveBy)).slice(0, 6), messages, live };
  }
}
