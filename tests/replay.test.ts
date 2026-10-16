// Replays the recorded-format scenarios in fixtures/replay/ through the real
// ingest → store → board pipeline and the HTTP API, on a manual clock.

import { describe, expect, it } from 'vitest';
import {
  displayPrediction,
  displayScheduled,
  formatHeadway,
  type DepartureGroup,
  type DepartureRow,
  type NearbyResponse,
  type StopBoard,
} from '@twalk/core';
import { stack } from './helpers.ts';

const T0 = Date.parse('2026-10-15T08:00:00-04:00');
const S = 1000;
const MIN = 60_000;

const group = (b: StopBoard, routeId: string, dir: 0 | 1 = 0): DepartureGroup | undefined =>
  b.groups.find((g) => g.routeId === routeId && g.directionId === dir);

/** What the rider would read for a row at `now`. */
function text(g: DepartureGroup, r: DepartureRow, now: number): string {
  if (r.canceled) return 'Canceled';
  if (r.source === 'scheduled' || r.source === 'vehicle') {
    const d = displayScheduled(now, r.scheduledTime!);
    return d.kind === 'hidden' ? '-' : d.text;
  }
  const d = displayPrediction({
    mode: g.mode,
    now,
    arrivalTime: r.arrivalTime,
    departureTime: r.departureTime,
    status: r.status,
    vehicleStoppedHere: r.vehicleStoppedHere,
  });
  return d.kind === 'hidden' ? '-' : d.text;
}

const read = (g: DepartureGroup | undefined, now: number) =>
  (g?.rows ?? []).slice(0, 3).map((r) => `${text(g!, r, now)} ${r.headsign} (${r.source}${r.mayNotRun ? ', may not run' : ''})`);

describe('normal service', () => {
  it('shows live subway, bus and commuter rail, each labelled', async () => {
    const s = await stack({ scenario: 'normal', start: T0 });
    const now = T0;
    const park = s.boards.board('place-pktrm');
    expect(read(group(park, 'Red'), now)).toEqual([
      'Boarding Ashmont/Braintree (live)',
      '6 min Ashmont/Braintree (live)',
      '13 min Ashmont/Braintree (live)',
    ]);
    // An ADDED trip's own headsign wins over the direction's destination.
    expect(read(group(park, 'Red', 1), now)).toEqual(['4 min Alewife (live)']);

    const bus = s.boards.board('B1');
    expect(read(group(bus, '1'), now)).toEqual([
      '5 min Harvard (live)',
      // uncertainty 300: schedule-based, so not "live"
      '19 min Harvard (estimate)',
      // not started yet, so no ghost flag
      '8:34 AM Harvard (scheduled)',
    ]);
    expect(group(bus, '1')?.rows[0]?.scheduledTime).toBe(Date.parse('2026-10-15T08:04:00-04:00'));

    const sstat = s.boards.board('place-sstat');
    const cr = group(sstat, 'CR-Worcester')!;
    expect(read(cr, now)).toEqual(['8:20 AM Worcester (live)']);
    expect(cr.rows[0]).toMatchObject({ status: 'On time', track: '3' });
  });

  it('follows removes and adds from the stream', async () => {
    const s = await stack({ scenario: 'normal', start: T0 });
    s.at(T0 + 55 * S);
    const red = group(s.boards.board('place-pktrm'), 'Red')!;
    expect(red.rows.map((r) => r.tripId)).toEqual(['ADDED-2', 'ADDED-3', 'ADDED-5']);
    expect(red.stale).toBe(false);
    expect(red.dataAgeSeconds).toBeLessThan(15);
  });

  it('serves nearby stops by walking time over HTTP', async () => {
    const s = await stack({ scenario: 'normal', start: T0 });
    const res = await s.app.inject({ url: '/api/nearby?lat=42.3566&lon=-71.0623&limit=5' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as NearbyResponse;
    expect(body.stops.map((x) => x.id)).toEqual(['B1', 'place-pktrm', 'place-sstat']);
    // Park Street is measured to its Tremont St door, and includes getting to the platform.
    const park = body.stops.find((x) => x.id === 'place-pktrm')!;
    expect(park.entranceName).toBe('Park Street - Tremont St');
    expect(park.walk.seconds).toBeGreaterThan(60);
    // The diversion-shuttle stop has nothing running, so it isn't offered.
    expect(body.stops.some((x) => x.id === 'SH1')).toBe(false);
    expect(body.status.predictions.heavy_rail).toMatchObject({ source: 'replay', state: 'live' });
  });
});

describe('delays', () => {
  it('keeps a stalled bus live but flagged, and shows the train as delayed', async () => {
    const s = await stack({ scenario: 'delays', start: T0 });
    const [late] = group(s.boards.board('B1'), '1')!.rows;
    expect(late).toMatchObject({ tripId: 'B-0750', source: 'live', stalled: true });
    const cr = group(s.boards.board('place-sstat'), 'CR-Worcester')!;
    expect(read(cr, T0)).toEqual(['8:35 AM Worcester (live)']);
    expect(cr.rows[0]?.status).toBe('Delayed');
  });

  it('flags a trip that should be running and has nothing live as "may not run"', async () => {
    const s = await stack({ scenario: 'delays', start: T0 });
    // B-0805 leaves B0 at 8:05; three minutes later, with nothing live, it's suspect.
    s.at(T0 + 7 * MIN);
    expect(group(s.boards.board('B1'), '1')!.rows.find((r) => r.tripId === 'B-0805')?.mayNotRun).toBe(false);
    s.at(T0 + 9 * MIN);
    const b0805 = group(s.boards.board('B1'), '1')!.rows.find((r) => r.tripId === 'B-0805');
    expect(b0805).toMatchObject({ source: 'scheduled', mayNotRun: true });
  });
});

describe('stream outage', () => {
  it('keeps the last data, dimmed, then falls back to the schedule, then recovers', async () => {
    const s = await stack({ scenario: 'outage', start: T0 });
    expect(group(s.boards.board('B1'), '1')?.rows[0]?.source).toBe('live');

    // Data was current until the stream closed at 8:01:00. 70 s later it's still
    // shown; subway (60 s allowed) is dimmed with its age, bus (90 s) not yet.
    s.at(T0 + 130 * S);
    let bus = group(s.boards.board('B1'), '1')!;
    expect(bus.rows[0]?.source).toBe('live');
    expect(bus).toMatchObject({ stale: false, dataAgeSeconds: 70 });
    let red = group(s.boards.board('place-pktrm'), 'Red')!;
    expect(red).toMatchObject({ stale: true, dataAgeSeconds: 70 });
    expect(s.boards.status().predictions.heavy_rail).toMatchObject({ state: 'stale', detail: 'Live stream interrupted' });

    // More than three minutes without data: live rows go, the schedule is shown and says so.
    s.at(T0 + 60 * S + 181 * S);
    bus = group(s.boards.board('B1'), '1')!;
    expect(bus.liveUnavailable).toBe(true);
    expect(bus.rows.every((r) => r.source === 'scheduled' && !r.mayNotRun)).toBe(true);
    expect(read(bus, s.clock.now())[0]).toBe('8:19 AM Harvard (scheduled)');
    red = group(s.boards.board('place-pktrm'), 'Red')!;
    expect(red.rows).toEqual([]);
    expect(formatHeadway(red.headway!.minMinutes, red.headway!.maxMinutes).text).toBe('Every 8–9 min');
    expect(s.boards.status().predictions.bus.state).toBe('down');

    // Back at 8:06.
    s.at(T0 + 6 * MIN + 20 * S);
    bus = group(s.boards.board('B1'), '1')!;
    expect(bus.liveUnavailable).toBe(false);
    expect(bus.rows[0]?.source).toBe('live');
    expect(s.boards.status().predictions.bus.state).toBe('live');
  });
});

describe('fallback feed', () => {
  it('uses the GTFS-realtime feed while the V3 stream is down, and says so', async () => {
    const s = await stack({ scenario: 'fallback', start: T0 });
    s.at(T0 + 100 * S);
    const h = s.boards.status().predictions.bus;
    expect(h.state).toBe('live');
    expect(h.detail).toMatch(/backup feed/);
    // The feed's own timestamp is the data age (produced 4 s before it was fetched).
    expect(h.lastUpdateAt).toBe(T0 + 100 * S - 4 * S);
    const rows = group(s.boards.board('B1'), '1')!.rows;
    expect(rows.slice(0, 2).map((r) => r.source)).toEqual(['live', 'estimate']);
    // No duplicates from the two sources.
    expect(new Set(rows.map((r) => r.tripId)).size).toBe(rows.length);
  });
});

describe('late night', () => {
  const T = Date.parse('2026-10-16T01:00:00-04:00');

  it("shows Thursday's 25:10 trip on Friday at 1 AM", async () => {
    const s = await stack({ scenario: 'late-night', start: T });
    const [row] = group(s.boards.board('B1'), '1')!.rows;
    expect(row).toMatchObject({ tripId: 'B-LATE', source: 'live' });
    expect(row?.scheduledTime).toBe(Date.parse('2026-10-16T01:10:00-04:00'));
    expect(text(group(s.boards.board('B1'), '1')!, row!, T)).toBe('12 min');
  });

  it('shows it from the schedule when nothing is live', async () => {
    const s = await stack({ start: T });
    const g = group(s.boards.board('B1'), '1')!;
    expect(read(g, T)).toEqual(['1:10 AM Harvard (scheduled)']);
    expect(g.liveUnavailable).toBe(true);
  });

  it('runs Saturday service on the holiday Monday', async () => {
    const s = await stack({ start: Date.parse('2026-10-12T08:50:00-04:00') });
    expect(group(s.boards.board('B1'), '1')!.rows.map((r) => r.tripId)).toEqual(['B-SAT']);
  });
});

describe('live endpoint', () => {
  it('rejects a request with no known stops', async () => {
    const s = await stack({ start: T0 });
    expect((await s.app.inject({ url: '/api/live?stops=nope' })).statusCode).toBe(400);
  });

  it('validates coordinates', async () => {
    const s = await stack({ start: T0 });
    expect((await s.app.inject({ url: '/api/nearby?lat=abc&lon=1' })).statusCode).toBe(400);
  });
});
