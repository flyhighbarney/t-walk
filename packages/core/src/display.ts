// How one departure is written, following the MBTA's Real-Time Display
// Guidelines (mbta.com/developers/real-time-display-guidelines, read 2026-10-15,
// which includes the February 2026 change that removed "Approaching").
//
// Where the guidelines are silent we choose the less precise wording:
// - Bus: a prediction that has gone more than a minute into the past is hidden
//   (the guidelines only say this for subway; a bus "Now" for minutes is wrong).
// - Ferry: shown as a clock time like Commuter Rail; the guidelines don't cover it.
// - Subway "Boarding" is checked before "Arriving", since a train already at the
//   platform is boarding even when it is under 30 seconds away.

import { formatClock } from './time.ts';
import { isSubway, type Mode } from './model.ts';

export interface DisplayInput {
  mode: Mode;
  now: number;
  arrivalTime: number | null;
  departureTime: number | null;
  status: string | null;
  /** The vehicle on this trip is STOPPED_AT this stop (or one of its platforms). */
  vehicleStoppedHere: boolean;
}

export type DisplayEmphasis = 'boarding' | 'arriving' | 'now' | null;

export type DisplayResult =
  | { kind: 'hidden'; reason: string }
  | {
      kind: 'countdown' | 'clock' | 'status';
      text: string;
      compact: string;
      /** Seconds until the vehicle, for sorting and screen readers. */
      seconds: number;
      emphasis: DisplayEmphasis;
    };

/** Round to the nearest minute, half up (the guidelines' rule). */
export function roundMinutes(seconds: number): number {
  return Math.floor(seconds / 60 + 0.5);
}

export function formatMinutes(minutes: number): { text: string; compact: string } {
  if (minutes < 60) return { text: `${minutes} min`, compact: `${minutes}m` };
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return {
    text: m === 0 ? `${h} hr` : `${h} hr ${m} min`,
    compact: m === 0 ? `${h}h` : `${h}h ${m}m`,
  };
}

const usesClockTime = (mode: Mode) => mode === 'commuter_rail' || mode === 'ferry';

/** A live (or schedule-based) prediction, written the MBTA's way. */
export function displayPrediction(input: DisplayInput): DisplayResult {
  const { mode, now, arrivalTime, departureTime, status } = input;
  if (departureTime == null) return { kind: 'hidden', reason: 'riders cannot board here' };
  const target = arrivalTime ?? departureTime;
  const seconds = (target - now) / 1000;

  if (usesClockTime(mode)) {
    // Commuter Rail shows its status *alongside* the time, so it isn't swapped in.
    if ((departureTime - now) / 1000 < 0) return { kind: 'hidden', reason: 'departed' };
    const clock = formatClock(departureTime);
    return { kind: 'clock', text: clock.full, compact: clock.compact, seconds, emphasis: null };
  }

  if (isSubway(mode)) {
    if (status) return { kind: 'status', text: status, compact: status, seconds, emphasis: null };
    const boarding =
      input.vehicleStoppedHere && (seconds <= 90 || (arrivalTime != null && arrivalTime <= now && departureTime > now));
    if (boarding) return { kind: 'status', text: 'Boarding', compact: 'BRD', seconds, emphasis: 'boarding' };
    if (seconds < 0) return { kind: 'hidden', reason: 'left the stop' };
    if (seconds <= 30) return { kind: 'status', text: 'Arriving', compact: 'ARR', seconds, emphasis: 'arriving' };
  } else {
    if (seconds < -60) return { kind: 'hidden', reason: 'left the stop' };
    if (seconds <= 30) return { kind: 'status', text: 'Now', compact: 'Now', seconds, emphasis: 'now' };
  }

  const { text, compact } = formatMinutes(roundMinutes(seconds));
  return { kind: 'countdown', text, compact, seconds, emphasis: null };
}

/**
 * A scheduled time. Always a clock time, never a countdown: a countdown reads
 * as live, and this isn't.
 */
export function displayScheduled(now: number, time: number): DisplayResult {
  const seconds = (time - now) / 1000;
  if (seconds < 0) return { kind: 'hidden', reason: 'scheduled time has passed' };
  const clock = formatClock(time);
  return { kind: 'clock', text: clock.full, compact: clock.compact, seconds, emphasis: null };
}

/** "Every 8–13 min", from the gaps between scheduled departures (subway only). */
export function formatHeadway(minMinutes: number, maxMinutes: number): { text: string; compact: string } {
  const lo = Math.max(1, Math.round(minMinutes));
  const hi = Math.max(lo, Math.round(maxMinutes));
  return lo === hi
    ? { text: `Every ${lo} min`, compact: `Every ${lo}m` }
    : { text: `Every ${lo}–${hi} min`, compact: `Every ${lo}–${hi}m` };
}

/** "updated 75s ago" / "updated 3 min ago". */
export function formatAge(seconds: number): string {
  if (seconds < 90) return `updated ${Math.max(0, Math.round(seconds))}s ago`;
  return `updated ${Math.round(seconds / 60)} min ago`;
}
