import { describe, expect, it } from 'vitest';
import { alertsFor, alertKind, formatAlertWhen } from './alerts.ts';
import type { Alert } from './model.ts';

const NOW = Date.parse('2026-10-16T12:00:00Z'); // Fri 8:00 AM in Boston
const H = 3600_000;

const alert = (over: Partial<Alert>): Alert => ({
  id: 'a',
  effect: 'DELAY',
  cause: 'UNKNOWN_CAUSE',
  header: 'Red Line: delays of about 10 minutes',
  description: null,
  severity: 5,
  lifecycle: 'NEW',
  timeframe: null,
  activePeriods: [{ start: NOW - H, end: NOW + 2 * H }],
  entities: [{ route: 'Red', activities: ['BOARD', 'EXIT', 'RIDE'] }],
  url: null,
  updatedAt: NOW,
  ...over,
});

const q = (over: Partial<Parameters<typeof alertsFor>[1]> = {}) => ({
  now: NOW,
  stopIds: new Set(['place-pktrm', '70075']),
  routeIds: new Set(['Red']),
  stepFree: false,
  ...over,
});

describe('which alerts are yours', () => {
  it('includes whole-line alerts for your lines and stop alerts for your stops', () => {
    const list = alertsFor(
      [
        alert({ id: 'line' }),
        alert({ id: 'stop', entities: [{ stop: '70075', activities: ['BOARD'] }] }),
        alert({ id: 'elsewhere', entities: [{ route: 'Orange', activities: ['RIDE'] }] }),
        alert({ id: 'other-stop', entities: [{ route: 'Red', stop: '70061', activities: ['BOARD'] }] }),
      ],
      q(),
    );
    expect(list.map((a) => a.id)).toEqual(['line', 'stop']);
  });

  it('shows elevator outages to step-free riders only', () => {
    const elevator = alert({ id: 'elev', effect: 'ELEVATOR_CLOSURE', entities: [{ stop: 'place-pktrm', facility: '901', activities: ['USING_WHEELCHAIR'] }] });
    expect(alertsFor([elevator], q())).toEqual([]);
    expect(alertsFor([elevator], q({ stepFree: true }))[0]).toMatchObject({ kind: 'elevator', accessibility: true });
  });

  it('never matches an elevator alert to a whole line', () => {
    const elevator = alert({ effect: 'ELEVATOR_CLOSURE', entities: [{ route: 'Red', activities: ['USING_WHEELCHAIR'] }] });
    expect(alertsFor([elevator], q({ stepFree: true }))).toEqual([]);
  });

  it('shows planned work a week ahead, after what is in effect now', () => {
    const planned = alert({ id: 'weekend', effect: 'SHUTTLE', severity: 7, activePeriods: [{ start: NOW + 36 * H, end: NOW + 80 * H }] });
    const far = alert({ id: 'far', activePeriods: [{ start: NOW + 20 * 24 * H, end: null }] });
    const list = alertsFor([planned, alert({ id: 'now', severity: 3 }), far], q());
    expect(list.map((a) => [a.id, a.upcoming])).toEqual([
      ['now', false],
      ['weekend', true],
    ]);
    expect(list[1]!.when).toBe('From 8:00 PM tomorrow to 4:00 PM Monday');
  });

  it('drops alerts that have ended', () => {
    expect(alertsFor([alert({ activePeriods: [{ start: NOW - 5 * H, end: NOW - H }] })], q())).toEqual([]);
  });
});

describe('wording', () => {
  it('says when, in Boston time', () => {
    expect(formatAlertWhen(NOW - H, NOW + 3 * H, NOW)).toBe('Until 11:00 AM');
    expect(formatAlertWhen(NOW - H, NOW + 20 * H, NOW)).toBe('Until 4:00 AM tomorrow');
    expect(formatAlertWhen(NOW - H, null, NOW)).toBe('Until further notice');
  });

  it('groups effects into kinds', () => {
    expect(alertKind('SUSPENSION')).toBe('suspension');
    expect(alertKind('ESCALATOR_CLOSURE')).toBe('escalator');
    expect(alertKind('PARKING_ISSUE')).toBe('info');
  });
});
