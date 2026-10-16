// Which alerts matter to you, and how to say when they apply.
//
// Matching follows the MBTA's V3 best practices: an alert is about a stop if
// an informed entity names that stop (or its station); it's about a route if
// an entity names the route without a stop (the whole line), or names the
// route at one of the stops you use. Elevator and escalator alerts are only
// about the stops they name.

import { formatClock, localDate, weekdayIndex } from './time.ts';
import type { Alert } from './model.ts';

export type AlertKind =
  | 'suspension'
  | 'shuttle'
  | 'closure'
  | 'detour'
  | 'delay'
  | 'elevator'
  | 'escalator'
  | 'accessibility'
  | 'stop-move'
  | 'service-change'
  | 'info';

export function alertKind(effect: string): AlertKind {
  switch (effect) {
    case 'SUSPENSION':
    case 'NO_SERVICE':
    case 'CANCELLATION':
      return 'suspension';
    case 'SHUTTLE':
      return 'shuttle';
    case 'STATION_CLOSURE':
    case 'STOP_CLOSURE':
    case 'DOCK_CLOSURE':
      return 'closure';
    case 'DETOUR':
    case 'SNOW_ROUTE':
      return 'detour';
    case 'DELAY':
    case 'SIGNIFICANT_DELAYS':
      return 'delay';
    case 'ELEVATOR_CLOSURE':
      return 'elevator';
    case 'ESCALATOR_CLOSURE':
      return 'escalator';
    case 'ACCESS_ISSUE':
    case 'ACCESSIBILITY_ISSUE':
      return 'accessibility';
    case 'STOP_MOVE':
    case 'STOP_MOVED':
      return 'stop-move';
    case 'SERVICE_CHANGE':
    case 'SCHEDULE_CHANGE':
    case 'MODIFIED_SERVICE':
    case 'TRACK_CHANGE':
      return 'service-change';
    default:
      return 'info';
  }
}

/** Kinds that can stop a trip working: worth a backup plan. */
export const DISRUPTIVE: ReadonlySet<AlertKind> = new Set(['suspension', 'shuttle', 'closure', 'detour']);
const ACCESS: ReadonlySet<AlertKind> = new Set(['elevator', 'escalator', 'accessibility']);

export interface AlertView {
  id: string;
  kind: AlertKind;
  header: string;
  description: string | null;
  severity: number;
  /** The active (or next) period. */
  start: number;
  end: number | null;
  /** Not in effect yet. */
  upcoming: boolean;
  /** "Until 3 AM Monday", "Sat 8:45 PM to Mon 5 AM". */
  when: string;
  url: string | null;
  routes: string[];
  /** Only for step-free riders, or noticed by everyone. */
  accessibility: boolean;
}

export interface AlertQuery {
  now: number;
  /** Stops you use, platforms and their stations both. */
  stopIds: ReadonlySet<string>;
  /** Lines you use (whole-line alerts). */
  routeIds: ReadonlySet<string>;
  stepFree: boolean;
  /** How far ahead to show planned work. */
  aheadMs?: number;
}

const DEFAULT_AHEAD_MS = 7 * 86_400_000;
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function dayLabel(t: number, now: number): string {
  const d = localDate(t);
  const today = localDate(now);
  if (d === today) return 'today';
  const diff = Math.round((Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`) - Date.parse(`${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6)}`)) / 86_400_000);
  if (diff === 1) return 'tomorrow';
  return DAY_NAMES[weekdayIndex(d)]!;
}

export function formatAlertWhen(start: number, end: number | null, now: number): string {
  const at = (t: number) => `${formatClock(t).full} ${dayLabel(t, now)}`.replace(' today', '');
  if (start > now) return end ? `From ${at(start)} to ${at(end)}` : `From ${at(start)}`;
  return end ? `Until ${at(end)}` : 'Until further notice';
}

function currentPeriod(a: Alert, now: number, aheadMs: number): { start: number; end: number | null; upcoming: boolean } | null {
  const periods = a.activePeriods.length > 0 ? a.activePeriods : [{ start: 0, end: null }];
  const active = periods.find((p) => p.start <= now && (p.end == null || p.end > now));
  if (active) return { ...active, upcoming: false };
  const next = periods.filter((p) => p.start > now && p.start - now <= aheadMs).sort((x, y) => x.start - y.start)[0];
  return next ? { ...next, upcoming: true } : null;
}

export function alertsFor(alerts: readonly Alert[], q: AlertQuery): AlertView[] {
  const out: AlertView[] = [];
  for (const a of alerts) {
    const kind = alertKind(a.effect);
    const access = ACCESS.has(kind);
    // Escalators matter to everyone a little, elevators mostly to step-free riders; only show them to those.
    if (access && !q.stepFree && kind !== 'escalator') continue;
    const matches = a.entities.some((e) => {
      if (e.stop) return q.stopIds.has(e.stop);
      if (access) return false;
      return e.route != null && q.routeIds.has(e.route);
    });
    if (!matches) continue;
    const period = currentPeriod(a, q.now, q.aheadMs ?? DEFAULT_AHEAD_MS);
    if (!period) continue;
    out.push({
      id: a.id,
      kind,
      header: a.header,
      description: a.description,
      severity: a.severity,
      start: period.start,
      end: period.end,
      upcoming: period.upcoming,
      when: formatAlertWhen(period.start, period.end, q.now),
      url: a.url,
      routes: [...new Set(a.entities.map((e) => e.route).filter((r): r is string => !!r))],
      accessibility: access,
    });
  }
  // In effect first, then the most severe.
  return out.sort((x, y) => Number(x.upcoming) - Number(y.upcoming) || y.severity - x.severity);
}
