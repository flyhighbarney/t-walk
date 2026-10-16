import { describe, expect, it } from 'vitest';
import { ArrivalHistory, MAX_EXTRA_BUFFER_S, MIN_SAMPLES, percentile, type HistoryKey } from './history.ts';
import { transferRisk, type TripLeg } from './trip.ts';

const key: HistoryKey = { routeId: 'Red', stopId: 'place-sstat' };
const fill = (h: ArrivalHistory, delays: number[], k = key) => delays.forEach((delayS, i) => h.record(k, { delayS, at: i }));

describe('percentile', () => {
  it('is null for no values and nearest-rank otherwise', () => {
    expect(percentile([], 0.8)).toBeNull();
    expect(percentile([5, 1, 3, 2, 4], 0.8)).toBe(4);
    expect(percentile([7], 0.8)).toBe(7);
  });
});

describe('ArrivalHistory', () => {
  it('says nothing until it has enough samples', () => {
    const h = new ArrivalHistory();
    fill(h, Array(MIN_SAMPLES - 1).fill(120));
    expect(h.extraBufferS(key)).toBeNull();
    h.record(key, { delayS: 120, at: 99 });
    expect(h.extraBufferS(key)).toBe(120);
  });

  it('clamps: early arrivals add nothing, huge delays are capped', () => {
    const early = new ArrivalHistory();
    fill(early, Array(10).fill(-90));
    expect(early.extraBufferS(key)).toBe(0);
    const late = new ArrivalHistory();
    fill(late, Array(10).fill(3600));
    expect(late.extraBufferS(key)).toBe(MAX_EXTRA_BUFFER_S);
  });

  it('keeps routes and stops apart, ignores bad samples, and caps memory', () => {
    const h = new ArrivalHistory();
    fill(h, Array(10).fill(60));
    h.record(key, { delayS: Number.NaN, at: 0 });
    expect(h.count(key)).toBe(10);
    expect(h.count({ routeId: 'Red', stopId: 'other' })).toBe(0);
    fill(h, Array(500).fill(60));
    expect(h.count(key)).toBe(200);
  });

  it('round-trips through JSON and drops junk', () => {
    const h = new ArrivalHistory();
    fill(h, Array(10).fill(90));
    const back = ArrivalHistory.fromJSON(JSON.parse(JSON.stringify(h)));
    expect(back.extraBufferS(key)).toBe(90);
    const dirty = ArrivalHistory.fromJSON({ 'a|b': [{ delayS: Number.NaN, at: 1 }, null as never], 'c|d': 'x' as never });
    expect(dirty.count({ routeId: 'a', stopId: 'b' })).toBe(0);
  });
});

describe('transferRisk with history', () => {
  const t = (m: number) => ({ scheduled: m * 60_000, estimated: null });
  const base: Omit<TripLeg, 'transit'> = {
    mode: 'SUBWAY',
    from: { name: 'A', lat: 0, lon: 0 },
    to: { name: 'B', lat: 0, lon: 0 },
    start: t(0),
    end: t(0),
    durationS: 0,
    distanceM: 0,
    source: 'live',
  } as never;
  const ride = (s: number, e: number): TripLeg => ({ ...base, transit: true, start: t(s), end: t(e) }) as TripLeg;
  const walk = (s: number, e: number): TripLeg => ({ ...base, transit: false, mode: 'WALK', start: t(s), end: t(e), durationS: (e - s) * 60 }) as TripLeg;
  const legs = [ride(0, 10), walk(10, 11), ride(14, 20)]; // 3 min spare (4 min gap, 1 min walk), live buffer 60 s → low

  it('widens the buffer of the arriving ride, and only that one', () => {
    expect(transferRisk(legs).level).toBe('low');
    const worse = transferRisk(legs, () => null, (i) => (i === 0 ? 120 : null));
    expect(worse.transfers[0]!.bufferS).toBe(180);
    expect(worse.level).toBe('medium');
    expect(transferRisk(legs, () => null, (i) => (i === 2 ? 120 : null)).level).toBe('low');
    expect(transferRisk(legs, () => null, (i) => (i === 0 ? 300 : null)).level).toBe('high');
  });
});
