// Where to draw a vehicle between its real position reports, honestly.
//
// - A new report: the marker glides from where it is drawn to the reported
//   point along the route line, over TRANSITION_MS. Nothing waits for it.
// - Between reports, a vehicle that is moving keeps going along its line at its
//   smoothed speed (an EMA over recent valid reports, so one noisy reading
//   doesn't jolt it), for at most EXTRAPOLATE_MAX_MS past its last report, and
//   never beyond the stop it is heading for. Then it holds still. This is the
//   only guessing, and it is a few hundred metres at most.
// - Its reported status shapes that guess: pulling away from a stop (STOPPED_AT
//   → IN_TRANSIT_TO) eases in over DEPARTURE_EASE_MS instead of jumping straight
//   to full speed; approaching one it's INCOMING_AT for eases out into the stop
//   instead of running at constant speed right up to it.
// - A vehicle not heard from for its mode's stale limit is drawn exactly where it
//   was last reported, greyed and labelled with its age. It doesn't move again
//   until a new report arrives.
// - Off its line (detours, shuttles, no shape): reported points only, no guessing.
// - Reduced motion: reported points only, no glide and no guessing.

export type VehicleRunStatus = 'INCOMING_AT' | 'STOPPED_AT' | 'IN_TRANSIT_TO' | null;

export interface VehicleReport {
  /** When the vehicle reported this position (its own updatedAt), epoch ms. */
  t: number;
  lon: number;
  lat: number;
  /** Metres along its route shape, or null if it isn't on one. */
  distance: number | null;
  /** The MBTA's own run status, when known. */
  status: VehicleRunStatus;
  /** Metres along the shape of the stop it's heading for, if known. */
  capDistance: number | null;
}

export interface Track {
  reports: VehicleReport[];
  /** Where the marker was drawn when the latest report arrived. */
  from: { lon: number; lat: number; distance: number | null } | null;
  /** When the latest report arrived (device time, server-corrected), ms. */
  arrivedAt: number;
  /** Smoothed speed along the shape (an EMA over valid reports), m/s, or null. */
  speed: number | null;
}

export const TRANSITION_MS = 1_000;
export const EXTRAPOLATE_MAX_MS = 10_000;
/** How long after leaving a stop the extrapolated run ramps up to full speed. */
export const DEPARTURE_EASE_MS = 5_000;
/** Faster than any MBTA vehicle; anything above is a GPS or matching error. */
const MAX_SPEED_MPS = 30;
/** Backwards jitter smaller than this is ignored (the marker never creeps backwards). */
const BACKWARD_JITTER_M = 30;
/** How much a new instantaneous speed reading moves the smoothed one. */
const SPEED_SMOOTHING = 0.5;

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
  let rawSpeed: number | null = null;
  if (prev && prev.distance != null && r.distance != null) {
    const dt = (r.t - prev.t) / 1000;
    const dd = r.distance - prev.distance;
    if (dt >= 2 && dt <= 120 && dd >= 0) {
      const v = dd / dt;
      rawSpeed = v <= MAX_SPEED_MPS ? v : null;
    }
  }
  // A rejected or anomalous reading (impossible speed, a real backward jump) stops
  // extrapolation rather than guessing from a now-stale trend; a plausible one smooths
  // into the running estimate instead of replacing it outright, so GPS jitter between
  // otherwise-good reports doesn't show up as a visible speed change.
  const prevSpeed = track?.speed ?? null;
  const speed = rawSpeed == null ? null : prevSpeed == null ? rawSpeed : prevSpeed + SPEED_SMOOTHING * (rawSpeed - prevSpeed);
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
const easeIn = (x: number) => x ** 3;

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
  if (onShape && last.status !== 'STOPPED_AT' && track.speed != null && track.speed > 0.3) {
    const capped = Math.min(age, EXTRAPOLATE_MAX_MS) / 1000;
    const hasCap = last.capDistance != null && last.capDistance >= last.distance!;
    let run: number;
    if (last.status === 'INCOMING_AT' && hasCap) {
      // Pulling into the stop it's heading for: ease the run down to a stop at the
      // platform instead of running at constant speed right up to it.
      const remaining = last.capDistance! - last.distance!;
      const eta = remaining / track.speed;
      const frac = eta > 0 ? Math.min(capped / eta, 1) : 1;
      run = remaining * easeOut(frac);
    } else {
      run = track.speed * capped;
      const justDeparted = last.status === 'IN_TRANSIT_TO' && track.reports.at(-2)?.status === 'STOPPED_AT';
      if (justDeparted) run *= easeIn(Math.min(age / DEPARTURE_EASE_MS, 1));
    }
    targetDistance = last.distance! + run;
    if (hasCap) targetDistance = Math.min(targetDistance, last.capDistance!);
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
