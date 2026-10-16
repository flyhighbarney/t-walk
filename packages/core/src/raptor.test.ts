import { describe, expect, it } from 'vitest';
import { decodeDay, decodeNetwork, encodeDay, encodeNetwork, NO_BOARD, type NetworkRoute } from './timetable.ts';
import { earliestArrival, journeyToTripOption, latestDeparture, TRANSFER_SLACK_S } from './raptor.ts';

// A made-up line of five stops 2.2 km apart (too far to walk between in the access radius):
//   A ── R1 ── B ── R1 ── C ── R2 ── D        E is 150 m from C, served by R3 to D.
const LAT0 = 42.3;
const LON = -71.1;
const STEP = 0.02;
const lat = Float32Array.from([LAT0, LAT0 + STEP, LAT0 + 2 * STEP, LAT0 + 3 * STEP, LAT0 + 2 * STEP + 0.00135]);
const lon = Float32Array.from([LON, LON, LON, LON, LON]);
const routes: NetworkRoute[] = ['R1', 'R2', 'R3'].map((id) => ({ id, label: id, name: `Route ${id}`, routeType: 3, color: null, textColor: null }));
const H = (h: number, m = 0) => h * 3600 + m * 60;

function network(cToEMinS = 0) {
  // One walking link each way between C (2) and E (4).
  const bytes = encodeNetwork(
    { feedVersion: 'test', builtAt: 'now', stopIds: ['A', 'B', 'C', 'D', 'E'], stopNames: ['A', 'B', 'C', 'D', 'E'], routes },
    {
      lat,
      lon,
      parent: Int32Array.from([-1, -1, -1, -1, -1]),
      fpOffsets: Uint32Array.from([0, 0, 0, 1, 1, 2]),
      fpTo: Uint32Array.from([4, 2]),
      fpMeters: Uint16Array.from([195, 195]),
      fpMinS: Uint16Array.from([cToEMinS, cToEMinS]),
    },
  );
  return decodeNetwork(bytes);
}

interface P {
  route: number;
  stops: number[];
  flags?: number[];
  /** Per trip: departure time at each stop (arrival = departure). */
  trips: number[][];
}

function day(patterns: P[]) {
  const patRoute = Uint16Array.from(patterns.map((p) => p.route));
  const patStopsOff = new Uint32Array(patterns.length + 1);
  const patTripsOff = new Uint32Array(patterns.length + 1);
  const stops: number[] = [];
  const flags: number[] = [];
  const tripStart: number[] = [];
  const tripTimesOff: number[] = [];
  const times: number[] = [];
  const tripIds: string[] = [];
  patterns.forEach((p, i) => {
    patStopsOff[i] = stops.length;
    patTripsOff[i] = tripStart.length;
    stops.push(...p.stops);
    flags.push(...(p.flags ?? p.stops.map(() => 0)));
    for (const t of p.trips) {
      tripIds.push(`${routes[p.route]!.id}-${t[0]}`);
      tripStart.push(t[0]!);
      tripTimesOff.push(times.length);
      for (const x of t) times.push(x - t[0]!, x - t[0]!);
    }
  });
  patStopsOff[patterns.length] = stops.length;
  patTripsOff[patterns.length] = tripStart.length;
  const bytes = encodeDay(
    { date: '20261019', feedVersion: 'test', tripIds, headsigns: tripIds.map(() => 'Somewhere') },
    {
      patRoute,
      patStopsOff,
      patStops: Uint32Array.from(stops),
      patFlags: Uint8Array.from(flags),
      patTripsOff,
      tripStart: Int32Array.from(tripStart),
      tripTimesOff: Uint32Array.from(tripTimesOff),
      times: Uint16Array.from(times),
    },
  );
  return decodeDay(bytes, 5);
}

const at = (s: number) => ({ lat: lat[s]!, lon: lon[s]! });

const r1 = { route: 0, stops: [0, 1, 2], trips: [[H(8), H(8, 5), H(8, 10)], [H(8, 10), H(8, 15), H(8, 20)], [H(8, 20), H(8, 25), H(8, 30)]] };

describe('timetable container', () => {
  it('round-trips the arrays and builds the stop → pattern index', () => {
    const d = day([r1]);
    expect([...d.patStops]).toEqual([0, 1, 2]);
    expect([...d.tripStart]).toEqual([H(8), H(8, 10), H(8, 20)]);
    expect(d.header.tripIds).toEqual(['R1-28800', 'R1-29400', 'R1-30000']);
    // Stop B (1) is position 1 of pattern 0.
    expect([...d.stopPat.subarray(d.stopPatOff[1]!, d.stopPatOff[2]!)]).toEqual([1]);
  });
});

describe('earliest arrival', () => {
  it('takes the first trip after you get to the stop', () => {
    const j = earliestArrival(network(), day([r1]), { from: at(0), to: at(2) }, H(8, 1))!;
    expect(j.rides).toBe(1);
    expect(j.arrive).toBe(H(8, 20));
    // Leave as late as the ride allows: the stop is where you are.
    expect(j.depart).toBe(H(8, 10));
  });

  it('changes vehicles only with time to spare', () => {
    const tight = { route: 1, stops: [2, 3], trips: [[H(8, 10) + TRANSFER_SLACK_S - 1, H(8, 20)], [H(8, 25), H(8, 35)]] };
    const j = earliestArrival(network(), day([r1, tight]), { from: at(0), to: at(3) }, H(7, 59))!;
    expect(j.rides).toBe(2);
    expect(j.arrive).toBe(H(8, 35)); // the 8:10:59 leaves too soon after the 8:10 arrival
    expect(j.legs.filter((l) => l.kind === 'ride').map((l) => (l.kind === 'ride' ? l.board : -1))).toEqual([0, 2]);
  });

  it('walks between nearby stops to change, and respects a minimum change time', () => {
    const fromE = { route: 2, stops: [4, 3], trips: [[H(8, 14), H(8, 24)], [H(8, 30), H(8, 40)]] };
    const quick = earliestArrival(network(0), day([r1, fromE]), { from: at(0), to: at(3) }, H(7, 59))!;
    expect(quick.arrive).toBe(H(8, 24)); // 195 m at 1.25 m/s is 156 s: 8:12:36, in time for 8:14
    const slow = earliestArrival(network(300), day([r1, fromE]), { from: at(0), to: at(3) }, H(7, 59))!;
    expect(slow.arrive).toBe(H(8, 40)); // a 5-minute change misses the 8:14
    expect(slow.legs.map((l) => l.kind)).toEqual(['walk', 'ride', 'walk', 'ride', 'walk']);
  });

  it("doesn't board where boarding isn't allowed", () => {
    const dropOff = { ...r1, flags: [NO_BOARD, 0, 0] };
    const j = earliestArrival(network(), day([dropOff]), { from: at(0), to: at(2) }, H(8));
    expect(j!.rides).toBe(0); // only walking is left
  });

  it('walks when that is quicker', () => {
    const near = { lat: lat[0]! + 0.003, lon: LON };
    const j = earliestArrival(network(), day([r1]), { from: at(0), to: near }, H(8))!;
    expect(j.rides).toBe(0);
    expect(j.legs).toHaveLength(1);
  });

  it('handles trips from the day before, on negative times', () => {
    const late = { route: 0, stops: [0, 1, 2], trips: [[-600, -300, 0]] };
    const j = earliestArrival(network(), day([late]), { from: at(0), to: at(2) }, -900)!;
    expect(j.arrive).toBe(0);
  });
});

describe('latest departure', () => {
  it('finds the latest you can leave and still arrive in time', () => {
    const j = latestDeparture(network(), day([r1]), { from: at(0), to: at(2) }, H(8, 25))!;
    expect(j.arrive).toBe(H(8, 20));
    expect(j.depart).toBe(H(8, 10));
  });

  it('gives null when nothing arrives in time', () => {
    expect(latestDeparture(network(), day([r1]), { from: at(0), to: at(2) }, H(7), 3600)).toBeNull();
  });

  it('becomes a TripOption with real clock times', () => {
    const d = day([r1]);
    const req = { from: { ...at(0), name: 'Home' }, to: { ...at(2), name: 'Work' } };
    const o = journeyToTripOption(network(), d, latestDeparture(network(), d, req, H(8, 25))!, req);
    expect(o.legs.map((l) => l.mode)).toEqual(['WALK', 'BUS', 'WALK']);
    expect(o.legs[0]!.from.name).toBe('Home');
    expect(o.legs[1]!.from.name).toBe('A');
    expect(o.legs[1]!.tripId).toBe('R1-29400');
    expect(o.end - o.start).toBe(10 * 60_000);
    expect(new Date(o.start).toISOString()).toBe('2026-10-19T12:10:00.000Z'); // 8:10 AM in Boston (EDT)
  });
});
