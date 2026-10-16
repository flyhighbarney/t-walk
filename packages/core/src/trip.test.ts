import { describe, expect, it } from 'vitest';
import {
  countTransfers,
  decodePolyline,
  foldRepeats,
  describeTransfer,
  mergeOptions,
  saferAlternative,
  sortOptions,
  transferRisk,
  type TripLeg,
  type TripOption,
} from './trip.ts';

const T = Date.parse('2026-10-16T12:00:00Z');
const min = (m: number) => T + m * 60_000;

const leg = (over: Partial<TripLeg>): TripLeg => ({
  mode: 'WALK',
  transit: false,
  from: { name: 'A', lat: 0, lon: 0, stopId: null, platform: null },
  to: { name: 'B', lat: 0, lon: 0, stopId: null, platform: null },
  start: { scheduled: min(0), estimated: null },
  end: { scheduled: min(5), estimated: null },
  source: 'walk',
  routeId: null,
  routeLabel: null,
  routeName: null,
  color: null,
  textColor: null,
  headsign: null,
  tripId: null,
  distanceM: 400,
  durationS: 300,
  geometry: [],
  steps: [],
  stopsBetween: 0,
  alerts: [],
  priceCents: null,
  stayOn: false,
  ...over,
});

const ride = (startMin: number, endMin: number, over: Partial<TripLeg> = {}) =>
  leg({
    mode: 'SUBWAY',
    transit: true,
    source: 'live',
    routeId: 'Red',
    tripId: `t${startMin}`,
    start: { scheduled: min(startMin), estimated: null },
    end: { scheduled: min(endMin), estimated: null },
    durationS: (endMin - startMin) * 60,
    from: { name: 'Park Street', lat: 0, lon: 0, stopId: 'S', platform: null },
    ...over,
  });

const walk = (startMin: number, mins: number) =>
  leg({ start: { scheduled: min(startMin), estimated: null }, end: { scheduled: min(startMin + mins), estimated: null }, durationS: mins * 60 });

describe('transfer risk', () => {
  it('has none without a transfer', () => {
    expect(transferRisk([walk(0, 5), ride(5, 15), walk(15, 3)]).level).toBe('none');
  });

  it('is low with plenty of spare time after the walk', () => {
    // Off at 15, 2 min walk, next train at 22: 5 min spare vs a 60 s live buffer.
    const r = transferRisk([ride(5, 15), walk(15, 2), ride(22, 30, { routeId: 'Orange' })]);
    expect(r.level).toBe('low');
    expect(r.transfers[0]).toMatchObject({ spareS: 300, walkS: 120, bufferS: 60 });
    expect(describeTransfer(r.transfers[0]!)).toBe('5 min to spare after a 2 min walk');
  });

  it('is high when the spare time is less than the arrival could slip', () => {
    // A live bus arriving at 15 (buffer 2 min), 1 min walk, next at 16.5: 30 s spare.
    const bus = ride(5, 15, { mode: 'BUS', routeId: '1' });
    expect(transferRisk([bus, walk(15, 1), ride(16.5, 30)]).level).toBe('high');
  });

  it('wants more margin after a scheduled arrival than a live one', () => {
    const legs = (source: TripLeg['source']) => [ride(5, 15, { source }), walk(15, 1), ride(18, 30)];
    expect(transferRisk(legs('live')).level).toBe('low'); // 2 min spare ≥ 2 × 60 s
    expect(transferRisk(legs('scheduled')).level).toBe('high'); // < 180 s
  });

  it("doesn't call a frequent connection risky, and says when the next one comes", () => {
    const legs = [ride(5, 15, { source: 'scheduled' }), walk(15, 1), ride(17, 30)];
    expect(transferRisk(legs).level).toBe('high');
    const r = transferRisk(legs, (i) => (i === 2 ? 4 * 60 : null));
    expect(r.level).toBe('medium');
    expect(describeTransfer(r.transfers[0]!)).toBe('1 min to spare after a 1 min walk; the next one is about 4 min later');
  });

  it("doesn't count staying on board as a transfer", () => {
    const legs = [ride(5, 15, { routeId: 'SL1' }), ride(15, 25, { routeId: 'SL1', stayOn: true })];
    expect(transferRisk(legs).level).toBe('none');
    expect(countTransfers(legs)).toBe(0);
  });

  it('uses real-time estimates when there are any', () => {
    const late = ride(5, 15, { end: { scheduled: min(15), estimated: min(19) } });
    expect(transferRisk([late, walk(19, 1), ride(21, 30)]).transfers[0]!.spareS).toBe(60);
  });
});

const option = (over: Partial<TripOption>): TripOption => ({
  id: Math.random().toString(),
  legs: [ride(0, 10)],
  start: min(0),
  end: min(30),
  durationS: 1800,
  walkS: 300,
  walkM: 400,
  transfers: 0,
  risk: { level: 'none', transfers: [] },
  fare: null,
  walkOnly: false,
  stepFree: false,
  alsoAt: [],
  ...over,
});

describe('sorting and merging', () => {
  const a = option({ id: 'a', end: min(30), walkS: 600, transfers: 1, risk: { level: 'high', transfers: [] } });
  const b = option({ id: 'b', end: min(34), walkS: 120, transfers: 0, risk: { level: 'none', transfers: [] }, legs: [ride(2, 20)] });
  const c = option({ id: 'c', end: min(32), walkS: 300, transfers: 2, risk: { level: 'low', transfers: [] }, legs: [ride(1, 20)] });

  it('sorts four ways', () => {
    expect(sortOptions([a, b, c], 'fastest', false).map((o) => o.id)).toEqual(['a', 'c', 'b']);
    expect(sortOptions([a, b, c], 'least-walking', false).map((o) => o.id)).toEqual(['b', 'c', 'a']);
    expect(sortOptions([a, b, c], 'fewest-transfers', false).map((o) => o.id)).toEqual(['b', 'a', 'c']);
    expect(sortOptions([a, b, c], 'most-reliable', false).map((o) => o.id)).toEqual(['b', 'c', 'a']);
  });

  it('for "arrive by", prefers leaving latest', () => {
    const late = option({ id: 'late', start: min(10) });
    const early = option({ id: 'early', start: min(0) });
    expect(sortOptions([early, late], 'fastest', true).map((o) => o.id)).toEqual(['late', 'early']);
  });

  it('folds the same route on later vehicles into one card', () => {
    const at = (m: number, id: string) => option({ id, start: min(m), end: min(m + 20), legs: [ride(m, m + 15)] });
    const other = option({ id: 'bus', start: min(3), legs: [ride(3, 20, { routeId: '1' })] });
    const folded = foldRepeats([at(0, 'a'), other, at(4, 'b'), at(9, 'c'), at(13, 'd'), at(18, 'e')]);
    expect(folded.map((o) => o.id)).toEqual(['a', 'bus']);
    expect(folded[0]!.alsoAt).toEqual([min(4), min(9), min(13)]);
  });

  it('drops the same trip found twice', () => {
    const dup = { ...a, id: 'a2' };
    expect(mergeOptions([[a, b], [dup, c]]).map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });

  it('suggests a safer option arriving a little later', () => {
    expect(saferAlternative(a, [a, b, c])?.id).toBe('c');
    expect(saferAlternative(c, [a, b, c])).toBeNull(); // c isn't risky
    expect(saferAlternative(a, [a, option({ id: 'slow', end: min(60) })])).toBeNull();
  });
});

describe('polyline', () => {
  it('decodes Google polylines to [lon, lat]', () => {
    // The reference example from Google's documentation.
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });
});
