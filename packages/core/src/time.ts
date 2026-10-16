// Time and service-day rules. Everything the rider sees is in Boston time,
// whatever the server's or the phone's own time zone is.
//
// GTFS times are not wall-clock times: a stop time is "seconds since noon minus
// 12 hours" on the service date (GTFS reference, "Field Types: Time"). That is
// midnight on every normal day, but on the two DST days it is an hour off, which
// is exactly what makes 01:30 and 25:30 come out right on those days. Times past
// 24:00:00 belong to the previous service day's late-night trips.

export const TZ = 'America/New_York';

const offsetFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  timeZoneName: 'longOffset',
  year: 'numeric',
});

/** Boston's offset from UTC at an instant, in minutes (-240 in summer, -300 in winter). */
export function tzOffsetMinutes(instantMs: number): number {
  const part = offsetFormat.formatToParts(new Date(instantMs)).find((p) => p.type === 'timeZoneName');
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(part?.value ?? '');
  if (!m) return 0; // "GMT" alone means +00:00
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * The instant at which Boston's wall clock reads the given time. For a time
 * that doesn't exist (the skipped hour in March) this gives the instant one
 * hour later; for one that happens twice (November) the first of the two.
 */
export function zonedTimeToInstant(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const before = tzOffsetMinutes(asUtc - 86_400_000);
  const after = tzOffsetMinutes(asUtc + 86_400_000);
  const valid = [...new Set([before, after])]
    .map((offset) => asUtc - offset * 60_000)
    .filter((t) => t + tzOffsetMinutes(t) * 60_000 === asUtc);
  if (valid.length > 0) return Math.min(...valid);
  // In the gap: read the wall time with the offset in force before the change.
  return asUtc - before * 60_000;
}

/** A service date as YYYYMMDD (GTFS's own format). */
export type ServiceDate = string;

export function parseServiceDate(date: ServiceDate): { y: number; m: number; d: number } {
  const clean = date.replaceAll('-', '');
  if (!/^\d{8}$/.test(clean)) throw new Error(`Bad service date: ${date}`);
  return { y: Number(clean.slice(0, 4)), m: Number(clean.slice(4, 6)), d: Number(clean.slice(6, 8)) };
}

/** "Noon minus 12h" on the service date: the zero point of its GTFS times. */
export function serviceDateBase(date: ServiceDate): number {
  const { y, m, d } = parseServiceDate(date);
  // Noon is never inside a DST change, so it always exists exactly once.
  return zonedTimeToInstant(y, m, d, 12) - 12 * 3600_000;
}

/** "25:10:00" → 90600. Hours may be ≥ 24. */
export function gtfsTimeToSeconds(time: string): number {
  const m = /^\s*(\d{1,3}):(\d{2}):(\d{2})\s*$/.exec(time);
  if (!m) throw new Error(`Bad GTFS time: ${time}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export function gtfsSecondsToInstant(date: ServiceDate, seconds: number): number {
  return serviceDateBase(date) + seconds * 1000;
}

const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Boston's calendar date at an instant, as YYYYMMDD. */
export function localDate(instantMs: number): ServiceDate {
  return dateFormat.format(new Date(instantMs)).replaceAll('-', '');
}

export function addDays(date: ServiceDate, days: number): ServiceDate {
  const { y, m, d } = parseServiceDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** 0 = Monday … 6 = Sunday, the order of GTFS calendar.txt's columns. */
export function weekdayIndex(date: ServiceDate): number {
  const { y, m, d } = parseServiceDate(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * The service dates whose trips can be running at `instant`: yesterday's
 * (late-night trips run to about 27:00) and today's.
 */
export function activeServiceDates(instantMs: number): ServiceDate[] {
  const today = localDate(instantMs);
  return [addDays(today, -1), today];
}

const clockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hour: 'numeric',
  minute: '2-digit',
});

/** "10:47 AM" and the compact "10:47", in Boston time. */
export function formatClock(instantMs: number): { full: string; compact: string } {
  const full = clockFormat.format(new Date(instantMs)).replace(/ /g, ' ');
  return { full, compact: full.replace(/\s?[AP]M$/, '') };
}
