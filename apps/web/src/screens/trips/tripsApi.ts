import { zonedTimeToInstant, type PlanResponse, type PlanSort, type WalkPace } from '@twalk/core';
import { getJson } from '../../lib/api.ts';

export interface Place {
  name: string;
  detail?: string;
  lat: number;
  lon: number;
  /** "My location" follows the device instead of a fixed point. */
  isHere?: boolean;
}

export interface PlaceResult {
  id: string;
  name: string;
  detail: string;
  lat: number;
  lon: number;
  kind: 'stop' | 'station' | 'place' | 'address';
}

export type TimeMode = 'now' | 'leave' | 'arrive';

export interface PlanInput {
  from: Place;
  to: Place;
  timeMode: TimeMode;
  /** "2026-10-16T08:15" in Boston time, for leave/arrive. */
  localTime: string;
  stepFree: boolean;
  pace: WalkPace;
  sort: PlanSort;
}

/** "2026-10-16T08:15" read as Boston time → epoch ms. */
export function bostonLocalToInstant(local: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  return zonedTimeToInstant(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

/** Now in Boston, as a datetime-local value. */
export function bostonLocalNow(now: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function planUrl(input: PlanInput, override?: { from?: Place; time?: number; timeMode?: TimeMode }): string {
  const from = override?.from ?? input.from;
  const mode = override?.timeMode ?? input.timeMode;
  const p = new URLSearchParams({
    from: `${from.lat.toFixed(5)},${from.lon.toFixed(5)}`,
    to: `${input.to.lat.toFixed(5)},${input.to.lon.toFixed(5)}`,
    fromName: from.name,
    toName: input.to.name,
    pace: input.pace,
    sort: input.sort,
  });
  if (input.stepFree) p.set('stepFree', '1');
  const time = override?.time ?? (mode === 'now' ? null : bostonLocalToInstant(input.localTime));
  if (time != null) p.set('time', new Date(time).toISOString());
  if (mode === 'arrive' && override?.time == null) p.set('arriveBy', '1');
  return `/api/plan?${p.toString()}`;
}

export const fetchPlan = (url: string, signal?: AbortSignal) => getJson<PlanResponse>(url, signal);

export function searchPlaces(q: string, near: { lat: number; lon: number } | null, signal?: AbortSignal) {
  const p = new URLSearchParams({ q });
  if (near) p.set('near', `${near.lat.toFixed(3)},${near.lon.toFixed(3)}`);
  return getJson<{ results: PlaceResult[]; placesAvailable: boolean }>(`/api/geocode?${p.toString()}`, signal);
}
