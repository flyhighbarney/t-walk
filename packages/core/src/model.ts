// The app's own shapes for MBTA data. Both upstream sources (the V3 API stream
// and the GTFS-realtime feeds) are mapped into these, so nothing past the
// adapters knows which one the data came from — except `FeedHealth.source`,
// which the rider is shown.

export type Mode = 'light_rail' | 'heavy_rail' | 'commuter_rail' | 'bus' | 'ferry';

/** GTFS route_type → mode. Unknown types are treated as bus (the most cautious display). */
export function modeFromRouteType(routeType: number): Mode {
  switch (routeType) {
    case 0:
      return 'light_rail';
    case 1:
      return 'heavy_rail';
    case 2:
      return 'commuter_rail';
    case 4:
      return 'ferry';
    default:
      return 'bus';
  }
}

export const isSubway = (mode: Mode): boolean => mode === 'light_rail' || mode === 'heavy_rail';

export interface RouteInfo {
  id: string;
  mode: Mode;
  shortName: string;
  longName: string;
  color: string; // "DA291C", no #
  textColor: string;
  sortOrder: number;
  /** False for routes the MBTA doesn't list, mostly diversion shuttles. */
  listed: boolean;
  /** direction_id → "Outbound" / "Southbound"… */
  directionNames: [string, string];
  /** direction_id → "Ashmont/Braintree"… */
  directionDestinations: [string, string];
}

/**
 * GTFS-realtime ScheduleRelationship, as either feed spells it. The V3 API
 * documents CANCELED but sends "CANCELLED" (seen live 2026-10-15); adapters
 * normalize to CANCELED.
 */
export type ScheduleRelationship = 'SCHEDULED' | 'ADDED' | 'SKIPPED' | 'CANCELED' | 'NO_DATA' | 'UNSCHEDULED';

export type UpdateType = 'MID_TRIP' | 'AT_TERMINAL' | 'REVERSE_TRIP';

export interface Prediction {
  id: string;
  tripId: string;
  routeId: string;
  stopId: string;
  directionId: 0 | 1;
  stopSequence: number;
  /** Epoch ms; null at a trip's first stop. */
  arrivalTime: number | null;
  /** Epoch ms; null where riders can't board (usually the last stop). */
  departureTime: number | null;
  arrivalUncertainty: number | null;
  departureUncertainty: number | null;
  scheduleRelationship: ScheduleRelationship | null;
  /** Free text such as "Stopped 2 stops away" or "All aboard". */
  status: string | null;
  vehicleId: string | null;
  /** Only when it differs from the trip's own headsign. */
  headsign: string | null;
  updateType: UpdateType | null;
  lastTrip: boolean;
  revenue: boolean;
}

export type VehicleStatus = 'INCOMING_AT' | 'STOPPED_AT' | 'IN_TRANSIT_TO';

export interface Vehicle {
  id: string;
  label: string;
  tripId: string | null;
  routeId: string | null;
  directionId: 0 | 1 | null;
  stopId: string | null;
  currentStatus: VehicleStatus | null;
  currentStopSequence: number | null;
  latitude: number;
  longitude: number;
  bearing: number | null;
  /** m/s */
  speed: number | null;
  occupancy: string | null;
  carriages: { label: string; occupancy: string | null; percentage: number | null }[];
  /** Epoch ms, from the vehicle's own report. */
  updatedAt: number;
  revenue: boolean;
}

export interface AlertEntity {
  route?: string;
  routeType?: number;
  directionId?: number;
  stop?: string;
  trip?: string;
  facility?: string;
  activities: string[];
}

export interface Alert {
  id: string;
  effect: string;
  cause: string;
  header: string;
  description: string | null;
  severity: number;
  lifecycle: string;
  timeframe: string | null;
  activePeriods: { start: number; end: number | null }[];
  entities: AlertEntity[];
  url: string | null;
  updatedAt: number;
}

/** One scheduled call at a stop, already turned into instants. */
export interface ScheduledStopTime {
  tripId: string;
  routeId: string;
  directionId: 0 | 1;
  headsign: string;
  stopId: string;
  stopSequence: number;
  serviceDate: string;
  arrivalTime: number | null;
  departureTime: number | null;
  /** 1 = no pickup here. */
  pickupType: number;
  dropOffType: number;
  /** When the trip leaves its first stop; used to tell "should be running by now". */
  tripStartTime: number;
}

export type FeedSource = 'v3-stream' | 'gtfs-rt' | 'replay' | 'none';
export type FeedState = 'live' | 'stale' | 'down';

export interface FeedHealth {
  source: FeedSource;
  state: FeedState;
  /** When the data was last known to be current (epoch ms), or null if never. */
  lastUpdateAt: number | null;
  /** Plain-language reason when not live. */
  detail: string | null;
}

/** How old live data may be before it is dimmed and labelled with its age. */
export function staleAfterSeconds(mode: Mode): number {
  switch (mode) {
    case 'light_rail':
    case 'heavy_rail':
      return 60;
    case 'bus':
      return 90;
    default:
      return 120;
  }
}

/** After this long without data, predictions are dropped and the schedule shown instead. */
export const DOWN_AFTER_SECONDS = 180;
