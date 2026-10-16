// The built-in planner (no OpenTripPlanner) on the fixture feed: route 1 runs
// B0 → B1 on weekdays at 7:50, 8:05 and 8:20 (14 minutes), and once at 24:55.

import { describe, expect, it } from 'vitest';
import { zonedTimeToInstant, type TripOption } from '@twalk/core';
import { planBuiltin } from '../apps/server/src/plan/builtin.ts';
import type { PlanRequest } from '../apps/server/src/plan/planner.ts';
import { fixtureDb } from './helpers.ts';

const B0 = { lat: 42.335, lon: -71.076, name: 'Home' };
const B1 = { lat: 42.357, lon: -71.063, name: 'Work' };
const helpers = { label: () => null, predictions: () => [], nextGap: () => null, historyBuffer: () => null };
const req = (over: Partial<PlanRequest>): PlanRequest => ({ from: B0, to: B1, time: null, arriveBy: false, stepFree: false, pace: 'normal', sort: 'fastest', ...over });
const ride = (o: TripOption) => o.legs.find((l) => l.transit)!;
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

describe('built-in planner', () => {
  it('takes the next bus and walks the ends', async () => {
    const db = await fixtureDb();
    const options = await planBuiltin(db, req({ time: zonedTimeToInstant(2026, 10, 15, 7, 55) }), 0, helpers);
    const first = options[0]!;
    expect(ride(first)).toMatchObject({ tripId: 'B-0805', routeId: '1', source: 'scheduled' });
    expect(clock(ride(first).start.scheduled)).toBe('8:05 AM');
    expect(first.legs.map((l) => l.mode)).toEqual(['WALK', 'BUS', 'WALK']);
    expect(first.legs[0]!.from.name).toBe('Home');
    expect(first.legs.at(-1)!.to.name).toBe('Work');
    // The later buses are offered too.
    expect(options.map((o) => ride(o)?.tripId)).toContain('B-0820');
  });

  it('arrives by a time: the latest bus that makes it', async () => {
    const db = await fixtureDb();
    const options = await planBuiltin(db, req({ time: zonedTimeToInstant(2026, 10, 15, 8, 30), arriveBy: true }), 0, helpers);
    expect(ride(options[0]!).tripId).toBe('B-0805'); // the 8:20 gets in at 8:34
    expect(options[0]!.end).toBeLessThanOrEqual(zonedTimeToInstant(2026, 10, 15, 8, 30));
  });

  it("finds last night's late bus after midnight", async () => {
    const db = await fixtureDb();
    const options = await planBuiltin(db, req({ time: zonedTimeToInstant(2026, 10, 16, 0, 50) }), 0, helpers);
    expect(ride(options[0]!).tripId).toBe('B-LATE');
    expect(clock(ride(options[0]!).start.scheduled)).toBe('12:55 AM');
  });

  it('stays off a line it is told to avoid', async () => {
    const db = await fixtureDb();
    const options = await planBuiltin(db, req({ time: zonedTimeToInstant(2026, 10, 15, 7, 55), avoidRoutes: ['1'] }), 0, helpers);
    expect(options.every((o) => o.walkOnly)).toBe(true);
  });
});
