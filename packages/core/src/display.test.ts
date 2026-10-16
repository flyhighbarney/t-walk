import { describe, expect, it } from 'vitest';
import { displayPrediction, displayScheduled, formatAge, formatHeadway, roundMinutes, type DisplayInput } from './display.ts';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const inSec = (s: number) => NOW + s * 1000;

const show = (over: Partial<DisplayInput> & { inSeconds?: number }) => {
  const { inSeconds = 300, ...rest } = over;
  const r = displayPrediction({
    mode: 'heavy_rail',
    now: NOW,
    arrivalTime: inSec(inSeconds),
    departureTime: inSec(inSeconds + 30),
    status: null,
    vehicleStoppedHere: false,
    ...rest,
  });
  return r.kind === 'hidden' ? 'hidden' : r.text;
};

describe('rounding', () => {
  it('rounds to the nearest minute, half up', () => {
    expect(roundMinutes(89)).toBe(1);
    expect(roundMinutes(90)).toBe(2);
    expect(roundMinutes(149)).toBe(2);
    expect(roundMinutes(150)).toBe(3);
  });
});

describe('subway', () => {
  it('says Arriving at 30 seconds or less, never Approaching', () => {
    expect(show({ inSeconds: 30 })).toBe('Arriving');
    expect(show({ inSeconds: 5 })).toBe('Arriving');
    expect(show({ inSeconds: 55 })).toBe('1 min');
  });

  it('counts down in minutes', () => {
    expect(show({ inSeconds: 31 })).toBe('1 min');
    expect(show({ inSeconds: 90 })).toBe('2 min');
    expect(show({ inSeconds: 8 * 60 })).toBe('8 min');
  });

  it('says Boarding when the train is stopped here', () => {
    expect(show({ inSeconds: 80, vehicleStoppedHere: true })).toBe('Boarding');
    expect(show({ inSeconds: 10, vehicleStoppedHere: true })).toBe('Boarding');
    // Arrival passed, departure still ahead.
    expect(show({ inSeconds: -20, vehicleStoppedHere: true })).toBe('Boarding');
    expect(show({ inSeconds: 120, vehicleStoppedHere: true })).toBe('2 min');
  });

  it('hides a train that has left', () => {
    expect(show({ inSeconds: -5 })).toBe('hidden');
  });

  it('shows the status in place of a countdown', () => {
    expect(show({ status: 'Stopped 2 stops away' })).toBe('Stopped 2 stops away');
  });

  it('hides a stop where you cannot board', () => {
    expect(show({ departureTime: null })).toBe('hidden');
  });
});

describe('bus', () => {
  it('says Now at 30 seconds or less', () => {
    expect(show({ mode: 'bus', inSeconds: 30 })).toBe('Now');
    expect(show({ mode: 'bus', inSeconds: -30 })).toBe('Now');
  });

  it('hides a bus more than a minute late to leave', () => {
    expect(show({ mode: 'bus', inSeconds: -61 })).toBe('hidden');
  });

  it('ignores the subway status text', () => {
    expect(show({ mode: 'bus', inSeconds: 240, status: 'whatever' })).toBe('4 min');
  });

  it('switches to hours at 60 minutes', () => {
    expect(show({ mode: 'bus', inSeconds: 59 * 60 + 29 })).toBe('59 min');
    expect(show({ mode: 'bus', inSeconds: 59 * 60 + 30 })).toBe('1 hr');
    expect(show({ mode: 'bus', inSeconds: 72 * 60 })).toBe('1 hr 12 min');
  });
});

describe('commuter rail', () => {
  it('shows the predicted departure as a clock time', () => {
    // 12:00Z + 47 min = 8:47 AM EDT
    const r = displayPrediction({
      mode: 'commuter_rail',
      now: NOW,
      arrivalTime: inSec(46 * 60),
      departureTime: inSec(47 * 60),
      status: 'On time',
      vehicleStoppedHere: false,
    });
    expect(r).toMatchObject({ kind: 'clock', text: '8:47 AM', compact: '8:47' });
  });
});

describe('schedule and helpers', () => {
  it('shows schedules as clock times, never countdowns', () => {
    expect(displayScheduled(NOW, inSec(4 * 60))).toMatchObject({ kind: 'clock', text: '8:04 AM' });
    expect(displayScheduled(NOW, inSec(-1)).kind).toBe('hidden');
  });

  it('formats headways and data age', () => {
    expect(formatHeadway(8.2, 12.6).text).toBe('Every 8–13 min');
    expect(formatHeadway(6, 6).text).toBe('Every 6 min');
    expect(formatAge(75)).toBe('updated 75s ago');
    expect(formatAge(185)).toBe('updated 3 min ago');
  });
});
