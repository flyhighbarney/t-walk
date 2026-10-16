import { describe, expect, it } from 'vitest';
import { learnedSpeed, navigate, stopsUntil, type NavFix, type NavProgress, type RideLive } from './nav.ts';
import type { TripLeg, TripOption } from './trip.ts';

const T0 = Date.parse('2026-10-16T08:00:00-04:00');
const LON = -71.06;
// 0.001° of latitude is about 111 m.
const at = (lat: number, t = T0, accuracy = 8): NavFix => ({ lat, lon: LON, accuracy, at: t });

function leg(p: Partial<TripLeg> & Pick<TripLeg, 'mode' | 'from' | 'to'>): TripLeg {
  return {
    transit: p.mode !== 'WALK',
    start: { scheduled: T0, estimated: null },
    end: { scheduled: T0, estimated: null },
    source: p.mode === 'WALK' ? 'walk' : 'live',
    routeId: null,
    routeLabel: null,
    routeName: null,
    color: null,
    textColor: null,
    headsign: null,
    tripId: null,
    distanceM: 0,
    durationS: 0,
    geometry: [],
    steps: [],
    stopsBetween: 0,
    alerts: [],
    priceCents: null,
    stayOn: false,
    ...p,
  };
}
const place = (name: string, lat: number, stopId: string | null = null) => ({ name, lat, lon: LON, stopId, platform: null });

// Walk 333 m north to Park Street, ride the Red Line north through two stops, walk 111 m.
const option: TripOption = {
  id: 'x',
  start: T0,
  end: T0 + 20 * 60_000,
  durationS: 1200,
  walkS: 360,
  walkM: 444,
  transfers: 0,
  risk: { level: 'none', checks: [] } as never,
  fare: null,
  walkOnly: false,
  stepFree: false,
  alsoAt: [],
  legs: [
    leg({
      mode: 'WALK',
      from: place('Home', 42.35),
      to: place('Park Street', 42.353, '70075'),
      distanceM: 333,
      durationS: 260,
      geometry: [
        [LON, 42.35],
        [LON, 42.353],
      ],
      stepPoints: [
        { text: 'Head north on Tremont St', lat: 42.35, lon: LON, distanceM: 200 },
        { text: 'Turn left on Winter St', lat: 42.352, lon: LON, distanceM: 133 },
      ],
    }),
    leg({
      mode: 'SUBWAY',
      from: place('Park Street', 42.353, '70075'),
      to: place('Kendall/MIT', 42.362, '70072'),
      start: { scheduled: T0 + 6 * 60_000, estimated: null },
      end: { scheduled: T0 + 14 * 60_000, estimated: null },
      routeId: 'Red',
      routeLabel: 'Red',
      routeName: 'Red Line',
      headsign: 'Alewife',
      tripId: 'R-1',
      distanceM: 1000,
      durationS: 480,
      geometry: [
        [LON, 42.353],
        [LON, 42.362],
      ],
      rideStops: [
        { name: 'Charles/MGH', stopId: '70074', lat: 42.356, lon: LON },
        { name: 'Stop B', stopId: '700B', lat: 42.359, lon: LON },
      ],
    }),
    leg({
      mode: 'WALK',
      from: place('Kendall/MIT', 42.362, '70072'),
      to: place('Office', 42.363),
      distanceM: 111,
      durationS: 100,
      geometry: [
        [LON, 42.362],
        [LON, 42.363],
      ],
    }),
  ],
};

const start: NavProgress = { legIndex: 0, onBoard: false, arrived: false };
const live = (stops: [string, number][], vehicle: RideLive['vehicle'] = null): RideLive => ({
  vehicle,
  stops: stops.map(([stopId, t]) => ({ stopId, name: stopId, arrivalTime: t, departureTime: t })),
});
const run = (progress: NavProgress, fix: NavFix | null, l: RideLive | null = null, now = T0) => navigate({ option, progress, fix, live: l, now, speed: 1.3 });

describe('navigation: walking', () => {
  it('gives the next turn and how far it is', () => {
    const { state } = run(start, at(42.3505));
    expect(state).toMatchObject({ phase: 'walk', maneuver: 'left', primary: 'Turn left on Winter St', secondary: 'Then the Red Line toward Alewife' });
    expect(state.distanceM).toBeGreaterThan(160);
    expect(state.distanceM).toBeLessThan(175);
  });

  it('says when you are off the route', () => {
    const { state } = run(start, { lat: 42.351, lon: LON + 0.002, accuracy: 8, at: T0 });
    expect(state.offRoute).toBe(true);
    expect(state.primary).toBe('Head back toward the route');
  });

  it("doesn't move you on a stale or vague fix", () => {
    expect(run(start, at(42.353, T0 - 60_000)).progress.legIndex).toBe(0);
    expect(run(start, at(42.353, T0, 200)).progress.legIndex).toBe(0);
  });

  it('warns when you would reach the stop after it leaves', () => {
    const l = live([['70075', T0 + 2 * 60_000]]);
    expect(run(start, at(42.3501), l).state.late).toBe(true);
    expect(run(start, at(42.3501)).state.late).toBe(false);
  });
});

describe('navigation: waiting and riding', () => {
  it('moves to the wait at the stop, with the live departure and how far away the train is', () => {
    const l = live([['70077', T0 + 3 * 60_000], ['70075', T0 + 5 * 60_000], ['70074', T0 + 7 * 60_000], ['70072', T0 + 13 * 60_000]]);
    const { state, progress } = run(start, at(42.353), l);
    expect(progress.legIndex).toBe(1);
    expect(state).toMatchObject({ phase: 'wait', primary: 'Board the Red Line toward Alewife', departsAt: T0 + 5 * 60_000, vehicleStopsAway: 2 });
    // Arrive = live arrival at Kendall + the last walk.
    expect(state.eta).toBe(T0 + 13 * 60_000 + 100_000);
  });

  it('counts stops from the live vehicle, then "next", then "get off"', () => {
    const riding: NavProgress = { legIndex: 1, onBoard: true, arrived: false };
    const v = (stopId: string, currentStatus: 'STOPPED_AT' | 'IN_TRANSIT_TO') => ({ lat: 42.355, lon: LON, stopId, currentStatus, updatedAt: T0 });
    expect(run(riding, null, live([['70074', T0], ['700B', T0], ['70072', T0]], v('70074', 'IN_TRANSIT_TO'))).state).toMatchObject({ stopsLeft: 3, primary: 'Get off in 3 stops', alight: 'none' });
    // Stopped at Stop B: it isn't ahead any more.
    expect(run(riding, null, live([['700B', T0], ['70072', T0]], v('700B', 'STOPPED_AT'))).state).toMatchObject({ stopsLeft: 1, alight: 'next', primary: 'Your stop is next: Kendall/MIT' });
    expect(run(riding, null, live([['70072', T0]], v('70072', 'STOPPED_AT'))).state).toMatchObject({ alight: 'now', primary: 'Get off at Kendall/MIT', secondary: 'Then walk to Office' });
  });

  it('follows the vehicle underground, where there is no GPS', () => {
    const riding: NavProgress = { legIndex: 1, onBoard: true, arrived: false };
    const l = live([['700B', T0], ['70072', T0]], { lat: 42.357, lon: LON, stopId: '700B', currentStatus: 'IN_TRANSIT_TO', updatedAt: T0 - 5_000 });
    expect(run(riding, null, l).state.position).toEqual({ lat: 42.357, lon: LON, source: 'vehicle' });
  });

  it('shows no stop count it cannot back up', () => {
    const riding: NavProgress = { legIndex: 1, onBoard: true, arrived: false };
    expect(run(riding, null, null).state).toMatchObject({ stopsLeft: null, primary: 'Ride to Kendall/MIT' });
    // With GPS above ground, it counts from where you are on the line.
    expect(run(riding, at(42.3575), null).state.stopsLeft).toBe(2);
  });

  it('notices you boarded when you move off along the line', () => {
    const { progress } = run({ legIndex: 1, onBoard: false, arrived: false }, at(42.357, T0 + 6 * 60_000), null, T0 + 6 * 60_000);
    expect(progress.onBoard).toBe(true);
  });

  it('moves to the last walk once the train passes your stop, then arrives', () => {
    const riding: NavProgress = { legIndex: 1, onBoard: true, arrived: false };
    const passed = run(riding, null, live([['70071', T0 + 60_000]], { lat: 42.364, lon: LON, stopId: '70071', currentStatus: 'IN_TRANSIT_TO', updatedAt: T0 }));
    expect(passed.progress).toEqual({ legIndex: 2, onBoard: false, arrived: false });
    const done = run(passed.progress, at(42.363));
    expect(done.progress.arrived).toBe(true);
    expect(done.state.phase).toBe('arrived');
  });

  it('stopsUntil ignores the stop the vehicle is standing at', () => {
    const l = live([['A', T0], ['B', T0]], { lat: 0, lon: 0, stopId: 'A', currentStatus: 'STOPPED_AT', updatedAt: T0 });
    expect(stopsUntil(l, 'B')).toBe(1);
    expect(stopsUntil(l, 'A')).toBeNull();
  });
});

describe('learned walking pace', () => {
  const walk = (n: number, metresPerStep: number, dt = 10, accuracy = 6) =>
    Array.from({ length: n }, (_, k) => ({ lat: 42.35 + (k * metresPerStep) / 111_000, lon: LON, accuracy, at: T0 + k * dt * 1000 }));

  it('measures speed once there is enough walking', () => {
    expect(learnedSpeed(walk(40, 14))).toBeCloseTo(1.4, 1);
    expect(learnedSpeed(walk(10, 14))).toBeNull();
  });

  it('leaves out vague fixes and anything faster than walking', () => {
    expect(learnedSpeed(walk(40, 14, 10, 50))).toBeNull();
    expect(learnedSpeed(walk(40, 40))).toBeNull();
  });
});
