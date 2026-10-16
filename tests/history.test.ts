// Server side of arrival history: recording delays from live predictions, and
// widening the transfer buffer once there's enough of them.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Prediction } from '@twalk/core';
import { DelayRecorder } from '../apps/server/src/live/delays.ts';

const MIN = 60_000;
const pred = (id: string, time: number, over: Partial<Prediction> = {}): Prediction => ({
  id, tripId: id, routeId: 'Red', stopId: 'place-knncl', directionId: 0, stopSequence: 5,
  arrivalTime: time, departureTime: time, arrivalUncertainty: null, departureUncertainty: null,
  scheduleRelationship: null, status: null, vehicleId: null, headsign: null, updateType: null,
  lastTrip: false, revenue: true, ...over,
});

function run(first: number, last: number, endAt: number, over: Partial<Prediction> = {}) {
  let t = 0;
  const r = new DelayRecorder(() => t);
  r.onSet(pred('a', first, over));
  t = 1 * MIN;
  r.onSet(pred('a', last, over));
  t = endAt;
  r.onDelete(pred('a', last, over));
  return r.history.count({ routeId: 'Red', stopId: 'place-knncl' });
}

describe('DelayRecorder', () => {
  it('records the gap between first-shown and final arrival', () => {
    expect(run(10 * MIN, 13 * MIN, 13 * MIN)).toBe(1);
  });
  it('ignores predictions first seen too close to arrival', () => {
    expect(run(3 * MIN, 4 * MIN, 4 * MIN)).toBe(0);
  });
  it('ignores predictions dropped long before arrival', () => {
    expect(run(20 * MIN, 21 * MIN, 5 * MIN)).toBe(0);
  });
  it('ignores cancelled trips', () => {
    expect(run(10 * MIN, 13 * MIN, 13 * MIN, { scheduleRelationship: 'CANCELED' })).toBe(0);
  });
  it('widens the buffer after 8 late arrivals and persists through save/load', () => {
    let t = 0;
    const r = new DelayRecorder(() => t);
    for (let i = 0; i < 8; i++) {
      t = i * 100 * MIN;
      r.onSet(pred(`t${i}`, t + 10 * MIN));
      t += 1 * MIN;
      r.onSet(pred(`t${i}`, t + 12 * MIN));
      t = t + 12 * MIN;
      r.onDelete(pred(`t${i}`, t));
    }
    const key = { routeId: 'Red', stopId: 'place-knncl' };
    expect(r.history.extraBufferS(key)).toBe(180);
    const file = join(mkdtempSync(join(tmpdir(), 'twalk-')), 'history.json');
    r.save(file);
    expect(DelayRecorder.load(file, () => t).history.extraBufferS(key)).toBe(180);
    expect(DelayRecorder.load(join(tmpdir(), 'nope', 'x.json'), () => t).history.count(key)).toBe(0);
  });
});

describe('transferRisk with history', () => {
  it('a tighter transfer turns riskier when the arriving line runs late', async () => {
    const { transferRisk } = await import('@twalk/core');
    const leg = (n: number, start: number, end: number) => ({
      transit: true, stayOn: false, source: 'scheduled', mode: 'subway', start: { scheduled: start, live: null }, end: { scheduled: end, live: null },
      from: { name: `S${n}` }, to: { name: `S${n + 1}` }, durationS: (end - start) / 1000,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legs = [leg(1, 0, 10 * MIN), leg(2, 10 * MIN + 400_000, 20 * MIN)] as any;
    const base = transferRisk(legs).transfers[0]!;
    const widened = transferRisk(legs, () => null, () => 300).transfers[0]!;
    expect(widened.bufferS).toBe(base.bufferS + 300);
    expect(['low', 'medium', 'high'].indexOf(widened.level)).toBeGreaterThanOrEqual(['low', 'medium', 'high'].indexOf(base.level));
  });
});

describe('ArrivalHistory.summary', () => {
  it('counts pairs, samples and pairs with enough samples', async () => {
    const { ArrivalHistory, MIN_SAMPLES } = await import('@twalk/core');
    const h = new ArrivalHistory();
    for (let i = 0; i < MIN_SAMPLES; i++) h.record({ routeId: 'Red', stopId: 'a' }, { delayS: 60, at: i });
    h.record({ routeId: 'Red', stopId: 'b' }, { delayS: 30, at: 1 });
    expect(h.summary()).toEqual({ pairs: 2, samples: MIN_SAMPLES + 1, usable: 1 });
  });

});
