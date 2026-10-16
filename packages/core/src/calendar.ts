// Which GTFS services run on a date: calendar.txt's weekly pattern and date
// range, then calendar_dates.txt's exceptions (1 = added, 2 = removed), which
// is how holidays like Indigenous Peoples' Day swap weekday service for Saturday's.

import { weekdayIndex, type ServiceDate } from './time.ts';

export interface CalendarRow {
  serviceId: string;
  /** Monday … Sunday */
  days: [boolean, boolean, boolean, boolean, boolean, boolean, boolean];
  startDate: ServiceDate;
  endDate: ServiceDate;
}

export interface CalendarException {
  serviceId: string;
  date: ServiceDate;
  /** 1 = service added on this date, 2 = removed. */
  exceptionType: 1 | 2;
}

export function activeServiceIds(
  date: ServiceDate,
  calendar: readonly CalendarRow[],
  exceptions: readonly CalendarException[],
): Set<string> {
  const active = new Set<string>();
  const day = weekdayIndex(date);
  for (const c of calendar) {
    if (c.startDate <= date && date <= c.endDate && c.days[day]) active.add(c.serviceId);
  }
  for (const e of exceptions) {
    if (e.date !== date) continue;
    if (e.exceptionType === 1) active.add(e.serviceId);
    else active.delete(e.serviceId);
  }
  return active;
}
