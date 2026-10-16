import { describe, expect, it } from 'vitest';
import { buildDepartures, type BuildDeparturesInput } from './departures.ts';
import { canMakeIt } from './canMakeIt.ts';
import { estimateWalk } from './walking.ts';
import type { FeedHealth, Prediction, RouteInfo, ScheduledStopTime, Vehicle } from './model.ts';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const min = (m: number) => NOW + m * 60_000;

const route = (id: string, mode: RouteInfo['mode'], sortOrder: number): RouteInfo => ({
  id,
  mode,
  shortName: id,
  longName: id,
  color: '000000',
  textColor: 'FFFFFF',
  sortOrder,
  listed: true,
  fareClass: null,
  directionNames: ['Outbound', 'Inbound'],
  directionDestinations: [`${id} out`, `${id} in`],
});

const ROUTES = new Map([
  ['Red', route('Red', 'heavy_rail', 1)],
  ['1', route('1', 'bus', 2)],
  ['CR-Worcester', route('CR-Worcester', 'commuter_rail', 3)],
]);

const live: FeedHealth = { source: 'v3-stream', state: 'live', lastUpdateAt: NOW - 5_000, detail: null };
const down: FeedHealth = { source: 'none', state: 'down', lastUpdateAt: NOW - 600_000, detail: 'stream down' };

const pred = (over: Partial<Prediction>): Prediction => ({
  id: 'p',
  tripId: 't1',
  routeId: '1',
  stopId: 'S',
  directionId: 0,
  stopSequence: 5,
  arrivalTime: min(4),
  departureTime: min(4),
  arrivalUncertainty: null,
  departureUncertainty: null,
  scheduleRelationship: null,
  status: null,
  vehicleId: null,
  headsign: null,
  updateType: null,
  lastTrip: false,
  revenue: true,
  ...over,
});

const sched = (over: Partial<ScheduledStopTime>): ScheduledStopTime => ({
  tripId: 't1',
  routeId: '1',
  directionId: 0,
  headsign: 'Harvard',
  stopId: 'S',
  stopSequence: 5,
  serviceDate: '20261015',
  arrivalTime: min(5),
  departureTime: min(5),
  pickupType: 0,
  dropOffType: 0,
  tripStartTime: min(-10),
  ...over,
});

const build = (over: Partial<BuildDeparturesInput>) =>
  buildDepartures({
    now: NOW,
    routes: ROUTES,
    predictions: [],
    schedules: [],
    vehicles: new Map(),
    stopIds: new Set(['S']),
    tripHeadsign: () => 'Harvard',
    trackedRoutes: new Set(['1', 'Red', 'CR-Worcester']),
    health: live,
    ...over,
  });

const rows = (over: Partial<BuildDeparturesInput>) => build(over).flatMap((g) => g.rows);

describe('labelling', () => {
  it('labels a real-time prediction live and attaches its scheduled time', () => {
    const [r] = rows({ predictions: [pred({})], schedules: [sched({})] });
    expect(r).toMatchObject({ source: 'live', departureTime: min(4), scheduledTime: min(5), headsign: 'Harvard' });
  });

  it('labels uncertainty 300 as a schedule-based estimate, not live', () => {
    const [r] = rows({ predictions: [pred({ departureUncertainty: 300 })] });
    expect(r?.source).toBe('estimate');
  });

  it('keeps 301 as live but stalled, and drops anything above', () => {
    expect(rows({ predictions: [pred({ departureUncertainty: 301 })] })[0]).toMatchObject({ source: 'live', stalled: true });
    expect(rows({ predictions: [pred({ departureUncertainty: 302 })] })).toHaveLength(0);
  });

  it('treats subway uncertainty codes as real predictions', () => {
    const [r] = rows({ predictions: [pred({ routeId: 'Red', departureUncertainty: 360 })] });
    expect(r?.source).toBe('live');
  });

  it('labels a scheduled trip with a vehicle on it but no prediction', () => {
    const v = { id: 'y1', tripId: 't9', currentStatus: 'IN_TRANSIT_TO' } as Vehicle;
    const [r] = rows({ schedules: [sched({ tripId: 't9' })], vehicles: new Map([['y1', v]]) });
    expect(r?.source).toBe('vehicle');
  });

  it('labels the timetable as scheduled', () => {
    const [r] = rows({ schedules: [sched({ tripStartTime: min(2) })] });
    expect(r).toMatchObject({ source: 'scheduled', mayNotRun: false });
  });

  it('skips stops where you cannot board', () => {
    expect(rows({ predictions: [pred({ departureTime: null })] })).toHaveLength(0);
    expect(rows({ schedules: [sched({ pickupType: 1 })] })).toHaveLength(0);
  });

  it('shows a canceled trip at its scheduled time', () => {
    const [r] = rows({ predictions: [pred({ scheduleRelationship: 'CANCELED', departureTime: null })], schedules: [sched({})] });
    expect(r).toMatchObject({ canceled: true, scheduledTime: min(5) });
  });

  it('uses the CR track from the platform code', () => {
    const [r] = rows({
      predictions: [pred({ routeId: 'CR-Worcester', stopId: 'S' })],
      platformCodes: new Map([['S', '3']]),
    });
    expect(r?.track).toBe('3');
  });

  it("doesn't call a subway platform code a track", () => {
    const [r] = rows({ predictions: [pred({ routeId: 'Red' })], platformCodes: new Map([['S', 'B']]) });
    expect(r?.track).toBeNull();
  });
});

describe('ghost detection', () => {
  it('flags a trip that should have started and has nothing live', () => {
    const [r] = rows({ schedules: [sched({ tripStartTime: min(-10) })] });
    expect(r?.mayNotRun).toBe(true);
  });

  it("doesn't flag a route the feed isn't tracking", () => {
    const [r] = rows({ schedules: [sched({})], trackedRoutes: new Set() });
    expect(r?.mayNotRun).toBe(false);
  });

  it("doesn't flag anything when live data is down", () => {
    const g = build({ schedules: [sched({})], predictions: [pred({ tripId: 'other' })], health: down });
    expect(g[0]?.rows[0]).toMatchObject({ source: 'scheduled', mayNotRun: false });
    expect(g[0]?.liveUnavailable).toBe(true);
  });

  it("doesn't flag trips far ahead", () => {
    const [r] = rows({ schedules: [sched({ departureTime: min(40), arrivalTime: min(40) })] });
    expect(r?.mayNotRun).toBe(false);
  });
});

describe('health', () => {
  it('ignores predictions and falls back to the schedule when live data is down', () => {
    const g = build({ predictions: [pred({ tripId: 'x' })], schedules: [sched({})], health: down });
    expect(g[0]?.rows.map((r) => r.source)).toEqual(['scheduled']);
    expect(g[0]?.dataAgeSeconds).toBeNull();
  });

  it('marks subway data stale after 60 seconds', () => {
    const stale = { ...live, lastUpdateAt: NOW - 75_000 };
    const g = build({ predictions: [pred({ routeId: 'Red' })], health: stale });
    expect(g[0]).toMatchObject({ stale: true, dataAgeSeconds: 75 });
    const bus = build({ predictions: [pred({})], health: stale });
    expect(bus[0]?.stale).toBe(false); // bus allows 90 s
  });

  it('treats data older than three minutes as down', () => {
    const old = { ...live, lastUpdateAt: NOW - 200_000 };
    const g = build({ predictions: [pred({})], health: old });
    expect(g).toHaveLength(0);
  });
});

describe('subway headways', () => {
  const red = (m: number, i: number) =>
    sched({ tripId: `r${i}`, routeId: 'Red', departureTime: min(m), arrivalTime: min(m) });

  it('shows a headway when there are no subway predictions', () => {
    const g = build({ schedules: [red(3, 1), red(11, 2), red(24, 3)] });
    expect(g[0]).toMatchObject({ routeId: 'Red', rows: [], headway: { minMinutes: 8, maxMinutes: 13 } });
  });

  it('never shows subway schedule rows next to predictions', () => {
    const g = build({ schedules: [red(3, 1), red(11, 2)], predictions: [pred({ routeId: 'Red', tripId: 'ADDED-1' })] });
    expect(g[0]?.rows.map((r) => r.tripId)).toEqual(['ADDED-1']);
    expect(g[0]?.headway).toBeNull();
  });
});

describe('ordering', () => {
  it('sorts rows by time and keeps four per direction (three shown, one spare)', () => {
    const ps = [9, 2, 6, 4, 12].map((m, i) => pred({ id: `p${i}`, tripId: `t${i}`, departureTime: min(m), arrivalTime: min(m) }));
    const [g] = build({ predictions: ps });
    expect(g?.rows.map((r) => r.tripId)).toEqual(['t1', 't3', 't2', 't0']);
  });

  it('leaves out a train that has already left', () => {
    const [g] = build({ predictions: [pred({ routeId: 'Red', arrivalTime: min(-0.5), departureTime: min(-0.2) }), pred({ id: 'p2', tripId: 't2', routeId: 'Red' })] });
    expect(g?.rows.map((r) => r.tripId)).toEqual(['t2']);
  });
});

describe('can I make it', () => {
  const walk = estimateWalk(400); // 520 m at 1.25 m/s ≈ 416 s, upper ≈ 499 s
  it('is comfortable with time to spare', () => {
    expect(canMakeIt({ now: NOW, leavesAt: min(12), walk, source: 'live' }).level).toBe('comfortable');
  });
  it('says hurry when only a faster walk makes it', () => {
    expect(canMakeIt({ now: NOW, leavesAt: min(6), walk, source: 'live' }).level).toBe('hurry');
  });
  it('says miss when even hurrying is too slow', () => {
    expect(canMakeIt({ now: NOW, leavesAt: min(4), walk, source: 'live' }).level).toBe('miss');
  });
  it('wants more margin for a scheduled time than a live one', () => {
    const leavesAt = min(11);
    expect(canMakeIt({ now: NOW, leavesAt, walk, source: 'live' }).level).toBe('comfortable');
    expect(canMakeIt({ now: NOW, leavesAt, walk, source: 'scheduled' }).level).toBe('hurry');
  });
});
