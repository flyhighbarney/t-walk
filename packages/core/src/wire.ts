// What the server sends the browser. Times are epoch ms; the browser re-runs
// the display rules every second against its own clock (corrected by the
// server's `now`), so countdowns tick without any network traffic.

import type { DepartureGroup } from './departures.ts';
import type { FeedHealth, Mode, RouteInfo } from './model.ts';
import type { WalkEstimate } from './walking.ts';

export interface StopSummary {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  isStation: boolean;
  modes: Mode[];
  routeIds: string[];
  /** GTFS wheelchair_boarding: 0 unknown, 1 accessible, 2 not accessible. */
  wheelchairBoarding: 0 | 1 | 2;
}

export interface NearbyStop extends StopSummary {
  /** Straight line to the nearest entrance (or the stop itself). */
  straightMeters: number;
  walk: WalkEstimate;
  entranceName: string | null;
}

export interface StopBoard {
  stopId: string;
  groups: DepartureGroup[];
  generatedAt: number;
}

export interface LiveStatus {
  now: number;
  /** Rail and bus predictions come from separate streams and can fail separately. */
  predictions: Record<Mode, FeedHealth>;
  vehicles: FeedHealth;
  alerts: FeedHealth;
  gtfsVersion: string | null;
}

export interface NearbyResponse {
  now: number;
  stops: NearbyStop[];
  boards: StopBoard[];
  routes: RouteInfo[];
  status: LiveStatus;
}

export interface StopResponse {
  now: number;
  stop: StopSummary;
  board: StopBoard;
  routes: RouteInfo[];
  status: LiveStatus;
}

/** Server-sent events on /api/live. */
export type LiveEvent =
  | { type: 'snapshot'; boards: StopBoard[]; routes: RouteInfo[]; status: LiveStatus }
  | { type: 'boards'; boards: StopBoard[]; status: LiveStatus }
  | { type: 'status'; status: LiveStatus };

// ── Map (Phase 2) ──────────────────────────────────────────────────────────

/** A vehicle as the map needs it. Times are epoch ms. */
export interface MapVehicle {
  id: string;
  label: string;
  routeId: string;
  tripId: string | null;
  directionId: 0 | 1 | null;
  mode: Mode;
  /** Its line's colour ("DA291C") and short label ("Red", "1", "SL5"). */
  color: string;
  routeLabel: string;
  latitude: number;
  longitude: number;
  bearing: number | null;
  currentStatus: 'INCOMING_AT' | 'STOPPED_AT' | 'IN_TRANSIT_TO' | null;
  /** The stop it is at or heading for (a platform), with its position. */
  stopId: string | null;
  stopLat: number | null;
  stopLon: number | null;
  occupancy: string | null;
  /** When the vehicle itself reported this position. */
  updatedAt: number;
  headsign: string | null;
  /** The GTFS shape of its trip, when the trip is in the schedule. */
  shapeId: string | null;
}

export type VehicleStreamEvent =
  | { type: 'snapshot'; vehicles: MapVehicle[]; status: LiveStatus }
  | { type: 'diff'; upserts: MapVehicle[]; removes: string[]; status: LiveStatus }
  | { type: 'status'; status: LiveStatus };

export interface ShapeFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: {
    routeId: string;
    shapeId: string;
    directionId: 0 | 1;
    mode: Mode;
    color: string;
    sortOrder: number;
    /** The most-used shape for this route and direction (drawn, and used for vehicles off-schedule). */
    main: boolean;
  };
}

export interface ShapeCollection {
  type: 'FeatureCollection';
  features: ShapeFeature[];
}

export interface MapStation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  routeIds: string[];
  modes: Mode[];
  /** Colour of its first line, for the ring. */
  color: string;
}

export interface VehicleStop {
  stopId: string;
  /** The station or stop a rider would recognise. */
  name: string;
  arrivalTime: number | null;
  departureTime: number | null;
  status: string | null;
  canceled: boolean;
}

export interface VehicleDetail {
  now: number;
  vehicle: MapVehicle;
  route: RouteInfo | null;
  /** Its remaining stops, from live predictions, in order. */
  stops: VehicleStop[];
  status: LiveStatus;
}

export interface BikeStation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  capacity: number | null;
  bikes: number;
  ebikes: number;
  docks: number;
  renting: boolean;
  returning: boolean;
  /** When the station last reported, epoch ms. */
  reportedAt: number | null;
}

export interface BikesResponse {
  now: number;
  /** When Bluebikes last updated its feed, epoch ms; null if not loaded yet. */
  updatedAt: number | null;
  stations: BikeStation[];
}

// ── Offline (Phase 4) ──────────────────────────────────────────────────────

/** A day of timetable for a few stops, kept on the device for when there's no signal. */
export interface OfflinePack {
  generatedAt: number;
  until: number;
  feedVersion: string | null;
  stops: (StopSummary & { platforms: string[] })[];
  routes: RouteInfo[];
  schedules: Record<string, import('./model.ts').ScheduledStopTime[]>;
}
