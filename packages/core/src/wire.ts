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
