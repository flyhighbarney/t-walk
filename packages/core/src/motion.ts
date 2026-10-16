// Where to draw a vehicle between its real position reports, honestly.
//
// - A new report: the marker glides from where it is drawn to the reported
//   point along the route line, over TRANSITION_MS. Nothing waits for it.
// - Between reports, a vehicle that is moving keeps going along its line at the
//   speed measured from its last two reports, for at most EXTRAPOLATE_MAX_MS
//   past its last report, and never beyond the stop it is heading for. Then it
//   holds still. This is the only guessing, and it is a few hundred metres at most.
// - A vehicle not heard from for its mode's stale limit is drawn exactly where it
//   was last reported, greyed and labelled with its age. It doesn't move again
//   until a new report arrives.
// - Off its line (detours, shuttles, no shape): reported points only, no guessing.
// - Reduced motion: reported points only, no glide and no guessing.

export interface VehicleReport {
  /** When the vehicle reported this position (its own updatedAt), epoch ms. */
  t: number;
  lon: number;
  lat: number;
  /** Metres along its route shape, or null if it isn't on one. */
  distance: number | null;
  /** In transit (not stopped at a stop). */
  moving: boolean;
  /** Metres along the shape of the stop it's heading for, if known. */
  capDistance: number | null;
}

export interface Track {
  reports: VehicleReport[];
  /** Where the marker was drawn when the latest report arrived. */
  from: { lon: number; lat: number; distance: number | null } | null;
  /** When the latest report arrived (device time, server-corrected), ms. */
  arrivedAt: number;
  /** Measured speed along the shape, m/s, or null. */
  speed: number | null;
}

export const TRANSITION_MS = 1_000;
export const EXTRAPOLATE_MAX_MS = 10_000;
/** Faster than any MBTA vehicle; anything above is a GPS or matching error. */
const MAX_SPEED_MPS = 30;
/** Backwards jitter smaller than this is ignored (the marker never creeps backwards). */
const BACKWARD_JITTER_M = 30;

export function addReport(track: Track | null, report: VehicleReport, now: number, drawnNow: { lon: number; lat: number; distance: number | null } | null): Track {
  const prev = track?.reports[track.reports.length - 1];
  if (prev && report.t <= prev.t) {
    // Same report sent again (or out of order): nothing new to show.
    return track!;
  }
  let r = report;
  if (prev && prev.distance != null && r.distance != null && r.distance < prev.distance && prev.distance - r.distance < BACKWARD_JITTER_M) {
    r = { ...r, distance: prev.distance };
  }
  let speed: number | null = null;
  if (prev && prev.distance != null && r.distance != null) {
    const dt = (r.t - prev.t) / 1000;
    const dd = r.distance - prev.distance;
    if (dt >= 2 && dt <= 120 && dd >= 0) {
      const v = dd / dt;
      speed = v <= MAX_SPEED_MPS ? v : null;
    }
  }
  return {
    reports: [...(track?.reports ?? []).slice(-2), r],
    from: drawnNow,
    arrivedAt: now,
    speed,
  };
}

export type MotionState = 'moving' | 'holding' | 'stale';

export interface DrawnPosition {
  lon: number;
  lat: number;
  /** Along the shape, when on one. */
  distance: number | null;
  state: MotionState;
  /** Seconds since the vehicle's last report. */
  ageSeconds: number;
}

const easeOut = (x: number) => 1 - (1 - x) ** 3;

/**
 * Where to draw the vehicle at `now`. `along` turns a distance on its shape
 * into a point (null when there's no shape).
 */
export function positionAt(
  track: Track,
  now: number,
  opts: {
    staleAfterMs: number;
    reducedMotion: boolean;
    along: ((distance: number) => { lon: number; lat: number }) | null;
  },
): DrawnPosition {
  const last = track.reports[track.reports.length - 1]!;
  const age = Math.max(0, now - last.t);
  const ageSeconds = age / 1000;
  const reported = { lon: last.lon, lat: last.lat };
  const onShape = last.distance != null && opts.along != null;

  if (age > opts.staleAfterMs) {
    const p = onShape ? opts.along!(last.distance!) : reported;
    return { ...p, distance: last.distance, state: 'stale', ageSeconds };
  }
  if (opts.reducedMotion || (!onShape && !track.from)) {
    return { ...reported, distance: last.distance, state: 'holding', ageSeconds };
  }

  // Target: the reported point, plus a short, capped run along the line if moving.
  let targetDistance = last.distance;
  let state: MotionState = 'holding';
  if (onShape && last.moving && track.speed != null && track.speed > 0.3) {
    const run = track.speed * (Math.min(age, EXTRAPOLATE_MAX_MS) / 1000);
    targetDistance = last.distance! + run;
    if (last.capDistance != null && last.capDistance >= last.distance!) targetDistance = Math.min(targetDistance, last.capDistance);
    state = age < EXTRAPOLATE_MAX_MS && targetDistance! > last.distance! ? 'moving' : 'holding';
  }

  const sinceArrival = now - track.arrivedAt;
  const glide = track.from && sinceArrival < TRANSITION_MS ? easeOut(Math.max(0, sinceArrival) / TRANSITION_MS) : 1;

  if (onShape) {
    const fromD = track.from?.distance;
    const d = glide < 1 && fromD != null ? fromD + (targetDistance! - fromD) * glide : targetDistance!;
    if (glide < 1 && fromD == null && track.from) {
      // Coming onto the line from off it: blend the points.
      const p = opts.along!(targetDistance!);
      return { lon: track.from.lon + (p.lon - track.from.lon) * glide, lat: track.from.lat + (p.lat - track.from.lat) * glide, distance: d, state: 'moving', ageSeconds };
    }
    return { ...opts.along!(d), distance: d, state: glide < 1 ? 'moving' : state, ageSeconds };
  }

  // Off the line: glide straight to the reported point, then hold.
  const f = track.from!;
  return {
    lon: f.lon + (reported.lon - f.lon) * glide,
    lat: f.lat + (reported.lat - f.lat) * glide,
    distance: null,
    state: glide < 1 ? 'moving' : 'holding',
    ageSeconds,
  };
}
