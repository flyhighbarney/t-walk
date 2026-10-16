// Walking estimates. Phase 1 has no street network yet (OpenTripPlanner comes
// in Phase 3), so a walk is the straight-line distance times a detour factor,
// and the result is always shown as approximate ("about 6 min walk").

export type WalkPace = 'slow' | 'normal' | 'fast';

/** Metres per second, including waiting at crossings. */
export const WALK_SPEED: Record<WalkPace, number> = {
  slow: 0.95,
  normal: 1.25,
  fast: 1.55,
};

/** Boston streets add about 30% over a straight line on average. */
export const DETOUR_FACTOR = 1.3;

/** Detours vary; the estimate can be this much longer. */
export const WALK_UNCERTAINTY = 0.2;

/** Getting from a station entrance to its platform, until pathways are used (Phase 5). */
export const STATION_ENTRY_SECONDS = 60;

const EARTH_RADIUS_M = 6_371_008.8;

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface WalkEstimate {
  meters: number;
  /** Best guess. */
  seconds: number;
  /** A pessimistic estimate, used to decide whether you can make it. */
  upperSeconds: number;
}

export function estimateWalk(straightMeters: number, pace: WalkPace = 'normal', extraSeconds = 0): WalkEstimate {
  const meters = straightMeters * DETOUR_FACTOR;
  const walk = meters / WALK_SPEED[pace];
  return {
    meters,
    seconds: walk + extraSeconds,
    upperSeconds: walk * (1 + WALK_UNCERTAINTY) + extraSeconds,
  };
}

/** "about 6 min walk"; under a minute is "under 1 min walk". */
export function formatWalk(seconds: number): string {
  const min = Math.round(seconds / 60);
  return min < 1 ? 'under 1 min walk' : `about ${min} min walk`;
}
