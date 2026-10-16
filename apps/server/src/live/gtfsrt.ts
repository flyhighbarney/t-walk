// The MBTA's public GTFS-realtime feeds, in their "enhanced JSON" form
// (cdn.mbta.com/realtime/*_enhanced.json). No API key needed. Used when there
// is no key, and as the fallback when the V3 stream is down.
//
// Field names checked against the live feed on 2026-10-15. The feed header's
// timestamp is when the MBTA produced the data, which is the honest data age.

import type { Alert, AlertEntity, Prediction, Vehicle, VehicleStatus } from '@twalk/core';
import type { Clock } from './clock.ts';
import type { EventSink, StreamName } from './events.ts';
import { normalizeRelationship } from './v3.ts';

export const GTFSRT_URLS: Partial<Record<StreamName, string>> = {
  'gtfsrt-trip-updates': 'https://cdn.mbta.com/realtime/TripUpdates_enhanced.json',
  'gtfsrt-vehicles': 'https://cdn.mbta.com/realtime/VehiclePositions_enhanced.json',
  // Public, no key: every alert, including elevator and escalator closures with their facility.
  'gtfsrt-alerts': 'https://cdn.mbta.com/realtime/Alerts_enhanced.json',
};

interface Feed<E> {
  header?: { timestamp?: number };
  entity?: E[];
}

interface TripDescriptor {
  trip_id?: string;
  route_id?: string;
  direction_id?: number;
  schedule_relationship?: string;
  revenue?: boolean;
  last_trip?: boolean;
}

interface TripUpdateEntity {
  id: string;
  trip_update?: {
    trip?: TripDescriptor;
    vehicle?: { id?: string };
    update_type?: string;
    stop_time_update?: {
      stop_id?: string;
      stop_sequence?: number;
      arrival?: { time?: number; uncertainty?: number };
      departure?: { time?: number; uncertainty?: number };
      schedule_relationship?: string;
      boarding_status?: string;
    }[];
  };
}

interface VehicleEntity {
  id: string;
  vehicle?: {
    trip?: TripDescriptor;
    vehicle?: { id?: string; label?: string };
    position?: { latitude?: number; longitude?: number; bearing?: number; speed?: number };
    current_status?: string;
    current_stop_sequence?: number;
    stop_id?: string;
    timestamp?: number;
    occupancy_status?: string;
    multi_carriage_details?: { label?: string; occupancy_status?: string; occupancy_percentage?: number }[];
  };
}

export function feedTimestamp(text: string): number | null {
  // The header comes first; avoid parsing a 500 KB document just for it.
  const m = /"timestamp"\s*:\s*(\d+)/.exec(text.slice(0, 400));
  return m ? Number(m[1]) * 1000 : null;
}

/** Same id scheme as the V3 API ("prediction-{trip}-{stop}-{seq}-{route}"), so the two sources line up. */
export const predictionId = (trip: string, stop: string, seq: number, route: string) =>
  `prediction-${trip}-${stop}-${seq}-${route}`;

export function predictionsFromTripUpdates(text: string): Prediction[] {
  const feed = JSON.parse(text) as Feed<TripUpdateEntity>;
  const out: Prediction[] = [];
  for (const e of feed.entity ?? []) {
    const tu = e.trip_update;
    const trip = tu?.trip;
    if (!tu || !trip?.trip_id || !trip.route_id) continue;
    const tripCanceled = normalizeRelationship(trip.schedule_relationship) === 'CANCELED';
    const update = tu.update_type?.toUpperCase();
    for (const s of tu.stop_time_update ?? []) {
      if (!s.stop_id || s.stop_sequence == null) continue;
      const rel = tripCanceled ? 'CANCELED' : normalizeRelationship(s.schedule_relationship);
      out.push({
        id: predictionId(trip.trip_id, s.stop_id, s.stop_sequence, trip.route_id),
        tripId: trip.trip_id,
        routeId: trip.route_id,
        stopId: s.stop_id,
        directionId: trip.direction_id === 1 ? 1 : 0,
        stopSequence: s.stop_sequence,
        arrivalTime: s.arrival?.time ? s.arrival.time * 1000 : null,
        departureTime: s.departure?.time ? s.departure.time * 1000 : null,
        arrivalUncertainty: s.arrival?.uncertainty ?? null,
        departureUncertainty: s.departure?.uncertainty ?? null,
        scheduleRelationship: rel,
        status: s.boarding_status ?? null,
        vehicleId: tu.vehicle?.id ?? null,
        headsign: null,
        updateType:
          update === 'MID_TRIP' || update === 'AT_TERMINAL' || update === 'REVERSE_TRIP' ? update : null,
        lastTrip: trip.last_trip === true,
        revenue: trip.revenue !== false,
      });
    }
  }
  return out;
}

const VEHICLE_STATUS = new Set(['INCOMING_AT', 'STOPPED_AT', 'IN_TRANSIT_TO']);

export function vehiclesFromFeed(text: string): Vehicle[] {
  const feed = JSON.parse(text) as Feed<VehicleEntity>;
  const out: Vehicle[] = [];
  for (const e of feed.entity ?? []) {
    const v = e.vehicle;
    const lat = v?.position?.latitude;
    const lon = v?.position?.longitude;
    if (!v || lat == null || lon == null) continue;
    const id = v.vehicle?.id ?? e.id;
    out.push({
      id,
      label: v.vehicle?.label ?? id,
      tripId: v.trip?.trip_id ?? null,
      routeId: v.trip?.route_id ?? null,
      directionId: v.trip?.direction_id === 0 || v.trip?.direction_id === 1 ? v.trip.direction_id : null,
      stopId: v.stop_id ?? null,
      currentStatus: v.current_status && VEHICLE_STATUS.has(v.current_status) ? (v.current_status as VehicleStatus) : null,
      currentStopSequence: v.current_stop_sequence ?? null,
      latitude: lat,
      longitude: lon,
      bearing: v.position?.bearing ?? null,
      speed: v.position?.speed ?? null,
      occupancy: v.occupancy_status ?? null,
      carriages: (v.multi_carriage_details ?? []).map((c) => ({
        label: c.label ?? '',
        occupancy: c.occupancy_status ?? null,
        percentage: c.occupancy_percentage ?? null,
      })),
      updatedAt: v.timestamp ? v.timestamp * 1000 : 0,
      revenue: v.trip?.revenue !== false,
    });
  }
  return out;
}

interface Translated {
  translation?: { text: string; language?: string }[];
}
const en = (t: Translated | undefined): string | null =>
  t?.translation?.find((x) => !x.language || x.language === 'en')?.text ?? t?.translation?.[0]?.text ?? null;

interface AlertEntityRaw {
  id: string;
  alert?: {
    cause?: string;
    cause_detail?: string;
    effect?: string;
    effect_detail?: string;
    severity?: number;
    active_period?: { start?: number; end?: number }[];
    informed_entity?: { stop_id?: string; route_id?: string; route_type?: number; direction_id?: number; trip?: { trip_id?: string }; facility_id?: string; activities?: string[] }[];
    header_text?: Translated;
    description_text?: Translated;
    timeframe_text?: Translated;
    alert_lifecycle?: string;
    url?: string | Translated;
    last_modified_timestamp?: number;
  };
}

/**
 * The enhanced feed's `effect_detail` (ELEVATOR_CLOSURE, SHUTTLE, SUSPENSION…)
 * uses the same names as the V3 API's `effect`; plain `effect` is the coarse
 * GTFS-realtime value (ACCESSIBILITY_ISSUE, NO_SERVICE…).
 */
export function alertsFromFeed(text: string): Alert[] {
  const feed = JSON.parse(text) as { entity?: AlertEntityRaw[] };
  const out: Alert[] = [];
  for (const e of feed.entity ?? []) {
    const a = e.alert;
    const header = a ? en(a.header_text) : null;
    if (!a || !header) continue;
    out.push({
      id: e.id,
      effect: a.effect_detail ?? a.effect ?? 'UNKNOWN_EFFECT',
      cause: a.cause_detail ?? a.cause ?? 'UNKNOWN_CAUSE',
      header,
      description: en(a.description_text),
      severity: a.severity ?? 0,
      lifecycle: a.alert_lifecycle ?? 'NEW',
      timeframe: en(a.timeframe_text),
      activePeriods: (a.active_period ?? []).map((p) => ({ start: (p.start ?? 0) * 1000, end: p.end ? p.end * 1000 : null })),
      entities: (a.informed_entity ?? []).map(
        (x): AlertEntity => ({
          route: x.route_id,
          routeType: x.route_type,
          directionId: x.direction_id,
          stop: x.stop_id,
          trip: x.trip?.trip_id,
          facility: x.facility_id,
          activities: x.activities ?? [],
        }),
      ),
      url: typeof a.url === 'string' ? a.url : en(a.url),
      updatedAt: (a.last_modified_timestamp ?? 0) * 1000,
    });
  }
  return out;
}

/**
 * Polls one feed with If-Modified-Since (the CDN answers 304 when nothing
 * changed). Emits open on the first success after a failure, close on failure.
 */
export class FeedPoller {
  private timer: NodeJS.Timeout | null = null;
  private lastModified: string | null = null;
  private healthy = false;
  private readonly stream: StreamName;
  private readonly sink: EventSink;
  private readonly clock: Clock;
  private readonly userAgent: string;
  private readonly intervalMs: number;
  running = false;

  constructor(opts: { stream: StreamName; sink: EventSink; clock: Clock; userAgent: string; intervalMs?: number }) {
    this.stream = opts.stream;
    this.sink = opts.sink;
    this.clock = opts.clock;
    this.userAgent = opts.userAgent;
    this.intervalMs = opts.intervalMs ?? 10_000;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastModified = null; // first poll after a (re)start always gets the full feed
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.healthy = false;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    try {
      const headers: Record<string, string> = { 'User-Agent': this.userAgent };
      if (this.lastModified) headers['If-Modified-Since'] = this.lastModified;
      const res = await fetch(GTFSRT_URLS[this.stream]!, { headers, signal: AbortSignal.timeout(15_000) });
      if (res.status !== 304) {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        this.lastModified = res.headers.get('last-modified');
        if (!this.healthy) this.sink({ t: this.clock.now(), stream: this.stream, kind: 'open' });
        this.healthy = true;
        this.sink({ t: this.clock.now(), stream: this.stream, kind: 'message', event: 'feed', data: text });
      }
    } catch (err) {
      if (this.healthy) this.sink({ t: this.clock.now(), stream: this.stream, kind: 'close', reason: (err as Error).message });
      this.healthy = false;
    }
    if (this.running) {
      this.timer = setTimeout(() => void this.tick(), this.intervalMs);
      this.timer.unref();
    }
  }
}
