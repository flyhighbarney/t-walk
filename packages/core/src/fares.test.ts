import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tripFare, type FareLeg, type FareRules } from './fares.ts';

// The real table the app uses.
const rules = JSON.parse(readFileSync(join(import.meta.dirname, '../../../config/fares.json'), 'utf8')) as FareRules;
const T = Date.parse('2026-10-16T12:00:00Z');
const ride = (fareClass: string, priceCents: number | null, atMin = 0): FareLeg => ({ fareClass, priceCents, start: T + atMin * 60_000 });

describe('MBTA fares (tap to pay / CharlieCard)', () => {
  it('charges one subway fare for a subway transfer', () => {
    expect(tripFare([ride('Rapid Transit', 240), ride('Rapid Transit', 240, 15)], rules).cents).toBe(240);
  });

  it('makes subway to local bus free', () => {
    expect(tripFare([ride('Rapid Transit', 240), ride('Local Bus', 170, 20)], rules).cents).toBe(240);
  });

  it('charges the difference from bus to subway', () => {
    expect(tripFare([ride('Local Bus', 170), ride('Rapid Transit', 240, 20)], rules).cents).toBe(240);
  });

  it('keeps bus to bus free, and bus, subway, bus at one subway fare', () => {
    expect(tripFare([ride('Local Bus', 170), ride('Local Bus', 170, 20)], rules).cents).toBe(170);
    expect(tripFare([ride('Local Bus', 170), ride('Rapid Transit', 240, 20), ride('Local Bus', 170, 40)], rules).cents).toBe(240);
  });

  it('charges again after the two-hour window', () => {
    expect(tripFare([ride('Local Bus', 170), ride('Local Bus', 170, 121)], rules).cents).toBe(340);
  });

  it('gives Commuter Rail and ferries no transfer discount', () => {
    expect(tripFare([ride('Commuter Rail', 1225), ride('Rapid Transit', 240, 100)], rules).cents).toBe(1465);
    expect(tripFare([ride('Rapid Transit', 240), ride('Ferry', 650, 20)], rules).cents).toBe(890);
  });

  it('is free on free shuttles, and gives no total when a price is missing', () => {
    expect(tripFare([ride('Free', 0)], rules).cents).toBe(0);
    expect(tripFare([ride('Rapid Transit', 240), ride('Local Bus', null, 10)], rules)).toEqual({ cents: null, label: 'Fare unknown for part of this trip' });
  });
});
