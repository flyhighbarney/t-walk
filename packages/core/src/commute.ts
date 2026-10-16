// Saved commutes: when the next one happens, and the leave-now message.

import { addDays, formatClock, localDate, weekdayIndex, zonedTimeToInstant, type ServiceDate } from './time.ts';
import { bestTime, type TripOption } from './trip.ts';

export interface CommutePlace {
  name: string;
  lat: number;
  lon: number;
}

export interface Commute {
  id: string;
  name: string;
  from: CommutePlace;
  to: CommutePlace;
  /** Arrive by `time`, or leave at `time`. */
  mode: 'arrive' | 'leave';
  /** "08:15", Boston time. */
  time: string;
  /** 0 = Monday … 6 = Sunday. */
  days: number[];
  stepFree: boolean;
  /** Leave-now notifications on (the server keeps a copy only then). */
  notify: boolean;
}

export const WEEKDAYS = [0, 1, 2, 3, 4];
const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function describeDays(days: readonly number[]): string {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (set.length === 7) return 'Every day';
  if (set.join() === WEEKDAYS.join()) return 'Weekdays';
  if (set.join() === '5,6') return 'Weekends';
  return set.map((d) => SHORT_DAYS[d]).join(', ');
}

export function parseHHMM(time: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? { h, m: min } : null;
}

/** The instant of a commute's time on a Boston date. */
export function commuteInstant(c: Pick<Commute, 'time'>, date: ServiceDate): number | null {
  const t = parseHHMM(c.time);
  if (!t) return null;
  return zonedTimeToInstant(Number(date.slice(0, 4)), Number(date.slice(4, 6)), Number(date.slice(6, 8)), t.h, t.m);
}

/**
 * The next time this commute happens: today's if it's still ahead (or under
 * way, within `graceMs` after the time), else the next matching day.
 */
export function nextOccurrence(c: Pick<Commute, 'time' | 'days'>, now: number, graceMs = 15 * 60_000): { date: ServiceDate; at: number } | null {
  if (c.days.length === 0) return null;
  const today = localDate(now);
  for (let i = 0; i < 8; i++) {
    const date = addDays(today, i);
    if (!c.days.includes(weekdayIndex(date))) continue;
    const at = commuteInstant(c, date);
    if (at != null && at + graceMs > now) return { date, at };
  }
  return null;
}

/** "Leave in 3 min to catch the 8:21 Orange Line." */
export function leaveMessage(option: TripOption, now: number, extra: { weatherNote?: string | null } = {}): { title: string; body: string; leaveAt: number } {
  const leaveAt = option.start;
  const mins = Math.max(0, Math.round((leaveAt - now) / 60_000));
  const first = option.legs.find((l) => l.transit);
  const when = mins <= 0 ? 'Leave now' : `Leave in ${mins} min`;
  if (!first) {
    return { title: `${when} to walk`, body: `Arrive about ${formatClock(option.end).full}.${extra.weatherNote ? ` ${extra.weatherNote}` : ''}`, leaveAt };
  }
  const line = first.mode === 'BUS' ? `${first.routeLabel} bus` : (first.routeName ?? first.routeLabel ?? 'train');
  const time = formatClock(bestTime(first.start)).full;
  const label = first.source === 'live' ? '' : first.source === 'estimate' ? ' (estimated)' : ' (scheduled)';
  return {
    title: `${when} to catch the ${time} ${line}`,
    body: `${label ? `Time is${label.replace(/[()]/g, '')}. ` : ''}From ${first.from.name}; arrive about ${formatClock(option.end).full}.${extra.weatherNote ? ` ${extra.weatherNote}` : ''}`,
    leaveAt,
  };
}
