// MBTA V3 API (JSON:API) → the app's model, and the stream URLs.
//
// Field names checked against https://api-v3.mbta.com/docs/swagger/swagger.json
// and live responses on 2026-10-15. Two places where the live API differs from
// the spec, both handled here:
// - predictions and vehicles send `revenue` ("REVENUE"/"NON_REVENUE"); the spec
//   calls the attribute `revenue_status`
// - schedule_relationship comes as "CANCELLED"; the spec says "CANCELED"

import type { Alert, AlertEntity, Prediction, ScheduleRelationship, UpdateType, Vehicle, VehicleStatus } from '@twalk/core';
import type { StreamName } from './events.ts';

export const V3_BASE = 'https://api-v3.mbta.com';

interface Resource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id: string; type: string } | null }>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const time = (v: unknown): number | null => {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};
const rel = (r: Resource, name: string): string | null => r.relationships?.[name]?.data?.id ?? null;
const dir = (v: unknown): 0 | 1 => (v === 1 ? 1 : 0);

export function normalizeRelationship(v: unknown): ScheduleRelationship | null {
  const s = str(v)?.toUpperCase();
  if (!s) return null;
  if (s === 'CANCELLED' || s === 'CANCELED') return 'CANCELED';
  if (s === 'SCHEDULED' || s === 'ADDED' || s === 'SKIPPED' || s === 'NO_DATA' || s === 'UNSCHEDULED') return s;
  return null;
}

const revenue = (a: Record<string, unknown>) => (a.revenue ?? a.revenue_status) !== 'NON_REVENUE';

export function predictionFromV3(r: Resource): Prediction | null {
  const a = r.attributes ?? {};
  const tripId = rel(r, 'trip');
  const routeId = rel(r, 'route');
  const stopId = rel(r, 'stop');
  if (!tripId || !routeId || !stopId) return null;
  const update = str(a.update_type)?.toUpperCase();
  return {
    id: r.id,
    tripId,
    routeId,
    stopId,
    directionId: dir(a.direction_id),
    stopSequence: numOrNull(a.stop_sequence) ?? 0,
    arrivalTime: time(a.arrival_time),
    departureTime: time(a.departure_time),
    arrivalUncertainty: numOrNull(a.arrival_uncertainty),
    departureUncertainty: numOrNull(a.departure_uncertainty),
    scheduleRelationship: normalizeRelationship(a.schedule_relationship),
    status: str(a.status),
    vehicleId: rel(r, 'vehicle'),
    headsign: str(a.trip_headsign),
    updateType: update === 'MID_TRIP' || update === 'AT_TERMINAL' || update === 'REVERSE_TRIP' ? (update as UpdateType) : null,
    lastTrip: a.last_trip === true,
    revenue: revenue(a),
  };
}

const VEHICLE_STATUS = new Set(['INCOMING_AT', 'STOPPED_AT', 'IN_TRANSIT_TO']);

export function vehicleFromV3(r: Resource): Vehicle | null {
  const a = r.attributes ?? {};
  const lat = numOrNull(a.latitude);
  const lon = numOrNull(a.longitude);
  if (lat == null || lon == null) return null;
  const status = str(a.current_status);
  const carriages = Array.isArray(a.carriages) ? (a.carriages as Record<string, unknown>[]) : [];
  return {
    id: r.id,
    label: str(a.label) ?? r.id,
    tripId: rel(r, 'trip'),
    routeId: rel(r, 'route'),
    directionId: a.direction_id === 0 || a.direction_id === 1 ? a.direction_id : null,
    stopId: rel(r, 'stop'),
    currentStatus: status && VEHICLE_STATUS.has(status) ? (status as VehicleStatus) : null,
    currentStopSequence: numOrNull(a.current_stop_sequence),
    latitude: lat,
    longitude: lon,
    bearing: numOrNull(a.bearing),
    speed: numOrNull(a.speed),
    occupancy: str(a.occupancy_status),
    carriages: carriages.map((c) => ({
      label: str(c.label) ?? '',
      occupancy: str(c.occupancy_status),
      percentage: numOrNull(c.occupancy_percentage),
    })),
    updatedAt: time(a.updated_at) ?? 0,
    revenue: revenue(a),
  };
}

export function alertFromV3(r: Resource): Alert | null {
  const a = r.attributes ?? {};
  const header = str(a.header);
  if (!header) return null;
  const periods = Array.isArray(a.active_period) ? (a.active_period as { start?: string; end?: string | null }[]) : [];
  const entities = Array.isArray(a.informed_entity) ? (a.informed_entity as Record<string, unknown>[]) : [];
  return {
    id: r.id,
    effect: str(a.effect) ?? 'UNKNOWN_EFFECT',
    cause: str(a.cause) ?? 'UNKNOWN_CAUSE',
    header,
    description: str(a.description),
    severity: numOrNull(a.severity) ?? 0,
    lifecycle: str(a.lifecycle) ?? 'NEW',
    timeframe: str(a.timeframe),
    activePeriods: periods.map((p) => ({ start: time(p.start) ?? 0, end: time(p.end) })),
    entities: entities.map(
      (e): AlertEntity => ({
        route: str(e.route) ?? undefined,
        routeType: numOrNull(e.route_type) ?? undefined,
        directionId: numOrNull(e.direction_id) ?? undefined,
        stop: str(e.stop) ?? undefined,
        trip: str(e.trip) ?? undefined,
        facility: str(e.facility) ?? undefined,
        activities: Array.isArray(e.activities) ? (e.activities as string[]) : [],
      }),
    ),
    url: str(a.url),
    updatedAt: time(a.updated_at) ?? 0,
  };
}

export interface V3StreamSpec {
  stream: StreamName;
  url: string;
  /** Reconnect after this long with no bytes. */
  silenceMs: number;
}

/**
 * The upstream streams. Predictions need a filter (filter[route_type] alone is
 * refused with a 400), so they're filtered by every route id, split into rail
 * and bus so a reset of one doesn't resend the other and one can fail alone.
 */
export function v3StreamSpecs(routesByType: Map<number, string[]>): V3StreamSpec[] {
  const ids = (types: number[]) => types.flatMap((t) => routesByType.get(t) ?? []);
  const predictions = (routes: string[]) =>
    `${V3_BASE}/predictions?filter[route]=${routes.map(encodeURIComponent).join(',')}`;
  const specs: V3StreamSpec[] = [];
  const rail = ids([0, 1, 2, 4]);
  const bus = ids([3]);
  if (rail.length) specs.push({ stream: 'predictions-rail', url: predictions(rail), silenceMs: 60_000 });
  if (bus.length) specs.push({ stream: 'predictions-bus', url: predictions(bus), silenceMs: 60_000 });
  specs.push({ stream: 'vehicles', url: `${V3_BASE}/vehicles`, silenceMs: 30_000 });
  // Alerts change rarely; silence is normal. activity=ALL so elevator,
  // escalator and wheelchair alerts aren't filtered out (the default is BOARD,EXIT,RIDE).
  specs.push({ stream: 'alerts', url: `${V3_BASE}/alerts?filter[activity]=ALL`, silenceMs: 15 * 60_000 });
  return specs;
}

export type V3Resource = Resource;
