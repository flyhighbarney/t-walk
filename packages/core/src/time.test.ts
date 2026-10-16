import { describe, expect, it } from 'vitest';
import {
  activeServiceDates,
  addDays,
  formatClock,
  gtfsSecondsToInstant,
  gtfsTimeToSeconds,
  localDate,
  serviceDateBase,
  tzOffsetMinutes,
  weekdayIndex,
  zonedTimeToInstant,
} from './time.ts';
import { activeServiceIds, type CalendarRow } from './calendar.ts';

const iso = (ms: number) => new Date(ms).toISOString();
const at = (date: string, time: string) => iso(gtfsSecondsToInstant(date, gtfsTimeToSeconds(time)));

describe('Boston offset', () => {
  it('is -4h in summer and -5h in winter', () => {
    expect(tzOffsetMinutes(Date.parse('2026-07-01T12:00:00Z'))).toBe(-240);
    expect(tzOffsetMinutes(Date.parse('2026-01-15T12:00:00Z'))).toBe(-300);
  });

  it('resolves wall times, including the skipped and repeated hours', () => {
    expect(iso(zonedTimeToInstant(2026, 10, 15, 8, 21))).toBe('2026-10-15T12:21:00.000Z');
    // 2:30 doesn't exist on 2026-03-08; read as 3:30 EDT.
    expect(iso(zonedTimeToInstant(2026, 3, 8, 2, 30))).toBe('2026-03-08T07:30:00.000Z');
    // 1:30 happens twice on 2026-11-01; the first (EDT) is chosen.
    expect(iso(zonedTimeToInstant(2026, 11, 1, 1, 30))).toBe('2026-11-01T05:30:00.000Z');
  });
});

describe('GTFS times', () => {
  it('parses hours past 24', () => {
    expect(gtfsTimeToSeconds('25:10:00')).toBe(90600);
    expect(gtfsTimeToSeconds(' 5:19:00')).toBe(19140);
    expect(() => gtfsTimeToSeconds('5:19')).toThrow();
  });

  it('counts from midnight on an ordinary day', () => {
    expect(iso(serviceDateBase('20261015'))).toBe('2026-10-15T04:00:00.000Z');
    expect(at('20261015', '08:21:00')).toBe('2026-10-15T12:21:00.000Z');
  });

  it('puts a late-night trip on the next calendar day', () => {
    // 25:10 on Thursday's service is 1:10 AM Friday.
    expect(at('20261015', '25:10:00')).toBe('2026-10-16T05:10:00.000Z');
    expect(localDate(gtfsSecondsToInstant('20261015', gtfsTimeToSeconds('25:10:00')))).toBe('20261016');
  });

  it('follows the "noon minus 12h" rule on the spring-forward day', () => {
    // Base is 11 PM EST the night before, so daytime times are right…
    expect(iso(serviceDateBase('20260308'))).toBe('2026-03-08T04:00:00.000Z');
    expect(at('20260308', '08:00:00')).toBe('2026-03-08T12:00:00.000Z'); // 8:00 EDT
    // …and a 01:30 time is 00:30 EST, as the spec defines.
    expect(at('20260308', '01:30:00')).toBe('2026-03-08T05:30:00.000Z');
  });

  it('follows the rule on the fall-back day', () => {
    expect(iso(serviceDateBase('20261101'))).toBe('2026-11-01T05:00:00.000Z');
    expect(at('20261101', '08:00:00')).toBe('2026-11-01T13:00:00.000Z'); // 8:00 EST
  });

  it('runs a late-night trip across the fall-back change', () => {
    // Saturday Oct 31 service, 25:30 → the first 1:30 AM on Nov 1 (EDT).
    expect(at('20261031', '25:30:00')).toBe('2026-11-01T05:30:00.000Z');
    // 26:30 is 7,200 s later in real time: 1:30 EST, the second one.
    expect(at('20261031', '26:30:00')).toBe('2026-11-01T06:30:00.000Z');
  });
});

describe('dates', () => {
  it("uses Boston's date, not UTC's", () => {
    expect(localDate(Date.parse('2026-10-16T03:59:00Z'))).toBe('20261015');
    expect(localDate(Date.parse('2026-10-16T04:00:00Z'))).toBe('20261016');
  });

  it('includes yesterday for late-night trips', () => {
    expect(activeServiceDates(Date.parse('2026-10-16T05:10:00Z'))).toEqual(['20261015', '20261016']);
  });

  it('adds days across months and years', () => {
    expect(addDays('20261231', 1)).toBe('20270101');
    expect(addDays('20260301', -1)).toBe('20260228');
  });

  it('numbers weekdays like calendar.txt', () => {
    expect(weekdayIndex('20261012')).toBe(0); // Monday
    expect(weekdayIndex('20261015')).toBe(3); // Thursday
    expect(weekdayIndex('20261018')).toBe(6); // Sunday
  });

  it('formats clock times in Boston time', () => {
    expect(formatClock(Date.parse('2026-10-15T14:47:00Z'))).toEqual({ full: '10:47 AM', compact: '10:47' });
    expect(formatClock(Date.parse('2026-01-15T22:05:00Z'))).toEqual({ full: '5:05 PM', compact: '5:05' });
  });
});

describe('service calendar', () => {
  const week = [true, true, true, true, true, false, false] as const;
  const sat = [false, false, false, false, false, true, false] as const;
  const calendar: CalendarRow[] = [
    { serviceId: 'Weekday', days: [...week], startDate: '20261007', endDate: '20261211' },
    { serviceId: 'Saturday', days: [...sat], startDate: '20261007', endDate: '20261211' },
  ];
  const exceptions = [
    { serviceId: 'Weekday', date: '20261012', exceptionType: 2 as const },
    { serviceId: 'Saturday', date: '20261012', exceptionType: 1 as const },
  ];

  it('runs weekday service on a weekday', () => {
    expect([...activeServiceIds('20261015', calendar, exceptions)]).toEqual(['Weekday']);
  });

  it('swaps in Saturday service on a holiday', () => {
    expect([...activeServiceIds('20261012', calendar, exceptions)]).toEqual(['Saturday']);
  });

  it('runs nothing outside the date range', () => {
    expect(activeServiceIds('20261214', calendar, exceptions).size).toBe(0);
  });
});
