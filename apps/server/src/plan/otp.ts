// OpenTripPlanner 2.10 client: its GTFS GraphQL API (planConnection), mapped
// to the app's TripOption shape. The browser never talks to OTP.

import {
  bestTime,
  countTransfers,
  decodePolyline,
  transferRisk,
  tripFare,
  type FareRules,
  type DepartureSource,
  type TripFare,
  type TripLeg,
  type TripMode,
  type TripOption,
} from '@twalk/core';

export interface OtpPlace {
  name?: string | null;
  lat: number;
  lon: number;
  stop?: { gtfsId: string; platformCode?: string | null } | null;
}

interface OtpTime {
  scheduledTime: string;
  estimated?: { time: string; delay?: string | null } | null;
}

export interface OtpLeg {
  mode: string;
  transitLeg: boolean;
  realTime?: boolean | null;
  interlineWithPreviousLeg?: boolean | null;
  start: OtpTime;
  end: OtpTime;
  duration: number;
  distance: number;
  from: OtpPlace;
  to: OtpPlace;
  route?: { gtfsId: string; shortName?: string | null; longName?: string | null; color?: string | null; textColor?: string | null } | null;
  trip?: { gtfsId: string; tripHeadsign?: string | null } | null;
  headsign?: string | null;
  legGeometry?: { points: string } | null;
  steps?: { relativeDirection?: string | null; streetName?: string | null; absoluteDirection?: string | null; distance?: number; lat?: number; lon?: number }[] | null;
  intermediatePlaces?: unknown[] | null;
  alerts?: { alertHeaderText?: string | null }[] | null;
  fareProducts?: {
    id: string;
    product?: {
      name?: string | null;
      medium?: { id: string; name?: string | null } | null;
      riderCategory?: { id: string; name?: string | null } | null;
      price?: { amount: number; currency?: { code: string } } | null;
    } | null;
  }[] | null;
}

export interface OtpItinerary {
  start: string;
  end: string;
  duration: number;
  walkDistance?: number | null;
  numberOfTransfers?: number | null;
  legs: OtpLeg[];
}

export const PLAN_QUERY = `
query Plan($origin: PlanLabeledLocationInput!, $destination: PlanLabeledLocationInput!, $dateTime: PlanDateTimeInput,
           $modes: PlanModesInput, $preferences: PlanPreferencesInput, $first: Int) {
  planConnection(origin: $origin, destination: $destination, dateTime: $dateTime, modes: $modes,
                 preferences: $preferences, first: $first) {
    routingErrors { code description }
    edges { node {
      start end duration walkDistance numberOfTransfers
      legs {
        mode transitLeg realTime duration distance headsign interlineWithPreviousLeg
        start { scheduledTime estimated { time delay } }
        end { scheduledTime estimated { time delay } }
        from { name lat lon stop { gtfsId platformCode } }
        to { name lat lon stop { gtfsId platformCode } }
        route { gtfsId shortName longName color textColor }
        trip { gtfsId tripHeadsign }
        legGeometry { points }
        steps { relativeDirection streetName absoluteDirection distance lat lon }
        intermediatePlaces { name lat lon stop { gtfsId } }
        alerts { alertHeaderText }
        fareProducts { id product { name medium { id name } riderCategory { id name } ... on DefaultFareProduct { price { amount currency { code } } } } }
      }
    } }
  }
}`;

export interface PlanQuery {
  from: { lat: number; lon: number; name?: string };
  to: { lat: number; lon: number; name?: string };
  /** Epoch ms. */
  time: number;
  arriveBy: boolean;
  stepFree: boolean;
  walkSpeed: number;
  /** 'fastest' uses OTP's defaults; the others tilt its costs; 'walk-only' asks for a walking route alone. */
  flavor: 'fastest' | 'least-walking' | 'fewest-transfers' | 'walk-only';
  first?: number;
  /** Lines to stay off (GTFS route ids, no feed prefix): backup plans around a disruption. */
  avoidRoutes?: string[];
}

export function planVariables(q: PlanQuery) {
  const iso = new Date(q.time).toISOString();
  const street = {
    walk: {
      speed: q.walkSpeed,
      // Higher reluctance: walking costs more, so OTP prefers riding.
      reluctance: q.flavor === 'least-walking' ? 6 : 2,
    },
  };
  return {
    origin: { location: { coordinate: { latitude: q.from.lat, longitude: q.from.lon } }, label: q.from.name ?? 'Start' },
    destination: { location: { coordinate: { latitude: q.to.lat, longitude: q.to.lon } }, label: q.to.name ?? 'Destination' },
    dateTime: q.arriveBy ? { latestArrival: iso } : { earliestDeparture: iso },
    modes:
      q.flavor === 'walk-only'
        ? { directOnly: true, direct: ['WALK'] }
        : { direct: ['WALK'], transit: { transit: [{ mode: 'BUS' }, { mode: 'SUBWAY' }, { mode: 'TRAM' }, { mode: 'RAIL' }, { mode: 'FERRY' }] } },
    preferences: {
      accessibility: { wheelchair: { enabled: q.stepFree } },
      street,
      transit: {
        transfer: { cost: q.flavor === 'fewest-transfers' ? 1200 : 60, slack: 'PT1M' },
        ...(q.avoidRoutes?.length ? { filters: [{ exclude: [{ routes: q.avoidRoutes.map((r) => `mbta:${r}`) }] }] } : {}),
      },
    },
    first: q.first ?? 5,
  };
}

const stripFeed = (id: string | null | undefined) => (id ? id.replace(/^[^:]+:/, '') : null);

const MODES: Record<string, TripMode> = { WALK: 'WALK', BUS: 'BUS', SUBWAY: 'SUBWAY', TRAM: 'TRAM', RAIL: 'RAIL', FERRY: 'FERRY', BICYCLE: 'BICYCLE' };

function stepText(s: NonNullable<OtpLeg['steps']>[number]): string {
  const street = s.streetName && !/^(path|sidewalk|service road|way)$/i.test(s.streetName) ? s.streetName : null;
  const dir = (s.relativeDirection ?? '').toUpperCase();
  const turn: Record<string, string> = {
    DEPART: 'Head',
    CONTINUE: 'Continue',
    LEFT: 'Turn left',
    RIGHT: 'Turn right',
    SLIGHTLY_LEFT: 'Bear left',
    SLIGHTLY_RIGHT: 'Bear right',
    HARD_LEFT: 'Turn sharp left',
    HARD_RIGHT: 'Turn sharp right',
    UTURN_LEFT: 'Turn around',
    UTURN_RIGHT: 'Turn around',
    ELEVATOR: 'Take the elevator',
    ENTER_STATION: 'Enter the station',
    EXIT_STATION: 'Leave the station',
    FOLLOW_SIGNS: 'Follow the signs',
  };
  const verb = turn[dir] ?? 'Continue';
  const heading = dir === 'DEPART' && s.absoluteDirection ? ` ${s.absoluteDirection.toLowerCase()}` : '';
  const dist = s.distance && s.distance >= 20 ? ` for ${Math.round(s.distance / 10) * 10} m` : '';
  return `${verb}${heading}${street ? ` on ${street}` : ''}${dist}`;
}

const t = (iso: string) => Date.parse(iso);

export interface LegLabeler {
  /** How sure a transit leg's departure is, from our own live store; null when we have nothing for it. */
  (leg: { tripId: string; stopId: string; routeId: string; otpRealTime: boolean }): DepartureSource | null;
}

/**
 * A ride's single fare. OTP (GTFS Fares v2, the MBTA's own tables) offers every
 * product that would pay for it: contactless, CharlieCard, CharlieTicket, cash,
 * and a $0 "Free fare" for riders who qualify. We quote tap to pay
 * (contactless = CharlieCard price).
 */
function ridePrice(l: OtpLeg): number | null {
  const priced = (l.fareProducts ?? []).filter((x) => x.product?.price != null);
  const pick =
    priced.find((x) => /contactless/i.test(x.product?.medium?.name ?? '')) ??
    priced.find((x) => /charliecard/i.test(x.product?.medium?.name ?? '')) ??
    priced.find((x) => (x.product?.price?.amount ?? 0) > 0) ??
    priced[0];
  return pick?.product?.price ? Math.round(pick.product.price.amount * 100) : null;
}

/** Without a fare table: count each OTP product use once (right within a mode, wrong for subway↔bus). */
function otpFare(legs: OtpLeg[]): TripFare | null {
  const transit = legs.filter((l) => l.transitLeg);
  if (transit.length === 0) return { cents: 0, label: 'Free (walking)' };
  const seen = new Map<string, number>();
  let unpriced = false;
  for (const l of transit) {
    const priced = (l.fareProducts ?? []).filter((x) => x.product?.price != null);
    const pick = priced.find((x) => /contactless/i.test(x.product?.medium?.name ?? '')) ?? priced.find((x) => (x.product?.price?.amount ?? 0) > 0) ?? priced[0];
    if (!pick?.product?.price) {
      unpriced = true;
      continue;
    }
    seen.set(pick.id, Math.round(pick.product.price.amount * 100));
  }
  if (seen.size === 0) return null;
  const cents = [...seen.values()].reduce((x, y) => x + y, 0);
  return { cents: unpriced ? null : cents, label: unpriced ? 'Fare unknown for part of this trip' : 'Tap to pay or CharlieCard' };
}

export function mapItinerary(
  it: OtpItinerary,
  opts: {
    label: LegLabeler;
    stepFree: boolean;
    nextGap?: (leg: TripLeg) => number | null;
    /** Extra buffer (seconds) for a leg's arrival, from how late that line really runs there. */
    historyBuffer?: (leg: TripLeg) => number | null;
    /** With these, the fare uses the configurable transfer table (config/fares.json). */
    fares?: { rules: FareRules; fareClass: (routeId: string) => string | null };
    /**
     * The names the plan was asked with ("Harvard Yard"). OTP names a point that
     * isn't a stop "Origin" or "Destination", so these win at the trip's two ends.
     */
    ends?: { from?: string | null; to?: string | null };
  },
): TripOption {
  const legs: TripLeg[] = it.legs.map((l) => {
    const mode = MODES[l.mode] ?? 'OTHER';
    const tripId = stripFeed(l.trip?.gtfsId);
    const fromStop = stripFeed(l.from.stop?.gtfsId);
    const routeId = stripFeed(l.route?.gtfsId);
    let source: TripLeg['source'] = 'walk';
    if (l.transitLeg) {
      const ours = tripId && fromStop && routeId ? opts.label({ tripId, stopId: fromStop, routeId, otpRealTime: !!l.realTime }) : null;
      // OTP knows nothing of the MBTA's "uncertainty 300" (schedule-based) code, so our store has the last word.
      source = ours ?? (l.realTime ? 'live' : 'scheduled');
    }
    return {
      mode,
      transit: l.transitLeg,
      from: { name: l.from.name ?? 'Start', lat: l.from.lat, lon: l.from.lon, stopId: fromStop, platform: l.from.stop?.platformCode ?? null },
      to: { name: l.to.name ?? 'Destination', lat: l.to.lat, lon: l.to.lon, stopId: stripFeed(l.to.stop?.gtfsId), platform: l.to.stop?.platformCode ?? null },
      start: { scheduled: t(l.start.scheduledTime), estimated: l.start.estimated ? t(l.start.estimated.time) : null },
      end: { scheduled: t(l.end.scheduledTime), estimated: l.end.estimated ? t(l.end.estimated.time) : null },
      source,
      routeId,
      routeLabel: l.route ? (l.route.shortName || l.route.longName?.replace(/ Line$/, '') || null) : null,
      routeName: l.route?.longName || l.route?.shortName || null,
      color: l.route?.color ?? null,
      textColor: l.route?.textColor ?? null,
      headsign: l.headsign ?? l.trip?.tripHeadsign ?? null,
      tripId,
      distanceM: l.distance,
      durationS: l.duration,
      geometry: l.legGeometry ? decodePolyline(l.legGeometry.points) : [],
      steps: (l.steps ?? []).map(stepText),
      stopsBetween: l.intermediatePlaces?.length ?? 0,
      alerts: [...new Set((l.alerts ?? []).map((a) => a.alertHeaderText).filter((x): x is string => !!x))],
      priceCents: l.transitLeg ? ridePrice(l) : null,
      stayOn: l.transitLeg && l.interlineWithPreviousLeg === true,
      stepPoints: (l.steps ?? [])
        .filter((s) => typeof s.lat === 'number' && typeof s.lon === 'number')
        .map((s) => ({ text: stepText(s), lat: s.lat!, lon: s.lon!, distanceM: s.distance ?? 0 })),
      rideStops: l.transitLeg
        ? (l.intermediatePlaces ?? []).flatMap((p) => {
            const q = p as { name?: string; lat?: number; lon?: number; stop?: { gtfsId?: string } | null };
            return typeof q.lat === 'number' && typeof q.lon === 'number' ? [{ name: q.name ?? 'Stop', stopId: stripFeed(q.stop?.gtfsId), lat: q.lat, lon: q.lon }] : [];
          })
        : [],
    };
  });
  const first = legs[0];
  const last = legs[legs.length - 1];
  if (first && !first.from.stopId && opts.ends?.from) first.from.name = opts.ends.from;
  if (last && !last.to.stopId && opts.ends?.to) last.to.name = opts.ends.to;
  const walk = legs.filter((l) => !l.transit);
  const transit = legs.filter((l) => l.transit);
  const start = t(it.start);
  const end = t(it.end);
  return {
    id: `${start}-${transit.map((l) => l.tripId ?? l.routeId).join('-') || 'walk'}`,
    legs,
    start,
    end,
    durationS: it.duration,
    walkS: walk.reduce((a, l) => a + l.durationS, 0),
    walkM: walk.reduce((a, l) => a + l.distanceM, 0),
    transfers: countTransfers(legs),
    risk: transferRisk(
      legs,
      (i) => opts.nextGap?.(legs[i]!) ?? null,
      (i) => opts.historyBuffer?.(legs[i]!) ?? null,
    ),
    fare: opts.fares
      ? tripFare(
          transit.map((l) => ({ fareClass: l.routeId ? opts.fares!.fareClass(l.routeId) : null, priceCents: l.priceCents, start: bestTime(l.start) })),
          opts.fares.rules,
        )
      : otpFare(it.legs),
    walkOnly: transit.length === 0,
    stepFree: opts.stepFree,
    alsoAt: [],
  };
}

export class OtpError extends Error {}

export interface OtpRoutingError {
  code: string;
  description: string;
}

export async function queryOtp(baseUrl: string, q: PlanQuery, signal?: AbortSignal): Promise<{ itineraries: OtpItinerary[]; errors: OtpRoutingError[] }> {
  const res = await fetch(`${baseUrl}/otp/gtfs/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: PLAN_QUERY, variables: planVariables(q) }),
    signal,
  });
  if (!res.ok) throw new OtpError(`OpenTripPlanner answered HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: { planConnection?: { edges: { node: OtpItinerary }[]; routingErrors?: { code: string; description: string }[] } };
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new OtpError(body.errors.map((e) => e.message).join('; '));
  const pc = body.data?.planConnection;
  return { itineraries: pc?.edges.map((e) => e.node) ?? [], errors: pc?.routingErrors ?? [] };
}
