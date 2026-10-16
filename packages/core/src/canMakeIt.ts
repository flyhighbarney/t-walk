// "Can I make it?" — your walk against the departure.
//
// - comfortable: at your normal pace, with the pessimistic walk estimate, you
//   arrive with time to spare (2 min plus a buffer that grows the less certain
//   the departure time is)
// - hurry: you only make it if you walk faster than usual
// - miss: even walking fast you get there after it leaves
//
// Always paired with an icon and a word in the UI; colour is never the only signal.

import type { WalkEstimate } from './walking.ts';
import type { DepartureSource } from './departures.ts';

export type Catchability = 'comfortable' | 'hurry' | 'miss';

/** Extra seconds of margin for how much the departure time itself might move. */
export const SOURCE_BUFFER_SECONDS: Record<DepartureSource, number> = {
  live: 30,
  estimate: 90,
  vehicle: 120,
  scheduled: 120,
};

const SPARE_SECONDS = 120;
/** Hurrying is about 30% faster than a usual pace. */
const HURRY_SPEEDUP = 1.3;

export function canMakeIt(input: {
  now: number;
  /** When it leaves (departure, else arrival), epoch ms. */
  leavesAt: number;
  walk: WalkEstimate;
  source: DepartureSource;
}): { level: Catchability; slackSeconds: number } {
  const secondsLeft = (input.leavesAt - input.now) / 1000;
  const slackSeconds = secondsLeft - input.walk.upperSeconds;
  if (slackSeconds >= SPARE_SECONDS + SOURCE_BUFFER_SECONDS[input.source]) {
    return { level: 'comfortable', slackSeconds };
  }
  if (secondsLeft - input.walk.seconds / HURRY_SPEEDUP >= 0) return { level: 'hurry', slackSeconds };
  return { level: 'miss', slackSeconds };
}

export const CATCHABILITY_LABEL: Record<Catchability, string> = {
  comfortable: 'You have time',
  hurry: 'Hurry',
  miss: "You'll miss it",
};
