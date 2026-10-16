// The trip planner over a recorded-format OTP response (fixtures/otp/plan.json),
// with live labels from the "normal" replay, and the place search.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlanResponse } from '@twalk/core';
import { Geocoder } from '../apps/server/src/plan/geocode.ts';
import { mapItinerary, planVariables, type OtpItinerary, type queryOtp } from '../apps/server/src/plan/otp.ts';
import { Planner } from '../apps/server/src/plan/planner.ts';
import { registerPlanRoutes } from '../apps/server/src/plan/routes.ts';
import { ROOT, stack } from './helpers.ts';

const T0 = Date.parse('2026-10-15T08:00:00-04:00');
const fixture = JSON.parse(readFileSync(join(ROOT, 'fixtures/otp/plan.json'), 'utf8')) as {
  data: { planConnection: { edges: { node: OtpItinerary }[] } };
};
const itineraries = fixture.data.planConnection.edges.map((e) => e.node);

async function setup(query: typeof queryOtp) {
  const s = await stack({ scenario: 'normal', start: T0 });
  const planner = new Planner({ otpUrl: 'http://otp', getDb: () => s.db, store: s.store, ingest: s.ingest, clock: s.clock, query });
  const geocoder = new Geocoder({
    userAgent: 'test',
    getDb: () => s.db,
    fetch: async () => new Response(JSON.stringify({ features: [] })),
  });
  registerPlanRoutes(s.app, { planner, geocoder });
  return { ...s, planner };
}

const FROM = '42.3580,-71.0640';
const TO = '42.3740,-71.1170';

describe('planning', () => {
  it('merges the variants, labels legs from our live data, and scores transfers', async () => {
    const calls: string[] = [];
    const s = await setup(async (_url, q) => {
      calls.push(q.flavor);
      return { itineraries, errors: [] };
    });
    const res = await s.app.inject({ url: `/api/plan?from=${FROM}&to=${TO}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PlanResponse;
    expect(calls.sort()).toEqual(['fastest', 'fewest-transfers', 'least-walking']);
    // Three answers with the same two trips: two options.
    expect(body.options).toHaveLength(2);
    // Fastest first: walking all the way arrives at 8:36.
    expect(body.options.map((o) => o.walkOnly)).toEqual([true, false]);

    const trip = body.options[1]!;
    const [, red, , bus] = trip.legs;
    // Subway legs with no matching live prediction are scheduled, not live.
    expect(red).toMatchObject({ mode: 'SUBWAY', source: 'scheduled', routeLabel: 'Red', headsign: 'Braintree', stopsBetween: 1 });
    expect(red!.alerts).toEqual(['Red Line: expect minor delays']);
    // OTP says real-time, but the MBTA marked B-0805 as schedule-based (uncertainty 300).
    expect(bus).toMatchObject({ mode: 'BUS', source: 'estimate', routeLabel: '1' });
    // Up Massachusetts Avenue to Harvard: decoded [lon, lat], the whole way in Boston and Cambridge.
    expect(bus!.geometry).toEqual([
      [-71.063, 42.357],
      [-71.0893, 42.3505],
      [-71.0935, 42.3592],
      [-71.1037, 42.3654],
      [-71.1189, 42.3732],
    ]);
    // Off the train at 8:14, a 2 min walk, the bus at 8:19: 3 min spare after a scheduled arrival.
    expect(trip.risk).toMatchObject({ level: 'medium', transfers: [{ at: 'Massachusetts Ave @ Tremont St', spareS: 180, walkS: 120 }] });
    expect(trip).toMatchObject({ transfers: 1, walkS: 600, walkM: 750, fare: { cents: 240 } });
    expect(trip.legs[0]!.steps).toEqual(['Head south on Tremont Street for 180 m', 'Turn left on Park Street for 120 m', 'Enter the station on Park Street']);
  });

  it('prices subway then bus as one fare with the fare table', async () => {
    const s = await stack({ scenario: 'normal', start: T0 });
    const fareRules = JSON.parse(readFileSync(join(ROOT, 'config/fares.json'), 'utf8'));
    // Make the bus ride's own price the local-bus fare, as OTP reports it.
    const legs = itineraries[0]!.legs.map((l) =>
      l.mode === 'BUS' ? { ...l, fareProducts: [{ id: 'bus', product: { name: 'Local Bus one-way fare', medium: { id: 'c', name: 'Contactless payment' }, riderCategory: null, price: { amount: 1.7 } } }] } : l,
    );
    const planner = new Planner({
      otpUrl: 'http://otp',
      getDb: () => s.db,
      store: s.store,
      ingest: s.ingest,
      clock: s.clock,
      fareRules,
      query: async () => ({ itineraries: [{ ...itineraries[0]!, legs }], errors: [] }),
    });
    const body = await planner.plan({ from: { lat: 42.358, lon: -71.064 }, to: { lat: 42.374, lon: -71.117 }, time: null, arriveBy: false, stepFree: false, pace: 'normal', sort: 'fastest' });
    const trip = body.options[0]!;
    // Red Line (Rapid Transit, $2.40) then route 1 (Local Bus): the bus is free.
    expect(trip.legs.filter((l) => l.transit).map((l) => l.priceCents)).toEqual([240, 170]);
    expect(trip.fare).toEqual({ cents: 240, label: 'Tap to pay or CharlieCard' });
  });

  it("names the trip's ends with the places asked for, not OTP's \"Destination\"", () => {
    const named = mapItinerary(itineraries[0]!, { label: () => 'live', stepFree: false, ends: { from: 'Park Street', to: 'Harvard Yard' } });
    expect(named.legs.at(-1)!.to.name).toBe('Harvard Yard');
    const plain = mapItinerary(itineraries[0]!, { label: () => 'live', stepFree: false });
    expect(plain.legs.at(-1)!.to.name).toBe('Destination');
  });

  it('sends OTP the right question', () => {
    const v = planVariables({
      from: { lat: 42.358, lon: -71.064 },
      to: { lat: 42.374, lon: -71.117 },
      time: T0,
      arriveBy: true,
      stepFree: true,
      walkSpeed: 0.95,
      flavor: 'least-walking',
    });
    expect(v.dateTime).toEqual({ latestArrival: '2026-10-15T12:00:00.000Z' });
    expect(v.preferences.accessibility.wheelchair.enabled).toBe(true);
    expect(v.preferences.street.walk).toEqual({ speed: 0.95, reluctance: 6 });
  });

  it('drops walking all the way when it is much slower than riding', async () => {
    const long = { ...itineraries[1]!, duration: 3 * 3600, end: '2026-10-15T11:00:00-04:00' };
    const s = await setup(async () => ({ itineraries: [itineraries[0]!, long], errors: [] }));
    const body = (await s.app.inject({ url: `/api/plan?from=${FROM}&to=${TO}` })).json() as PlanResponse;
    expect(body.options.every((o) => !o.walkOnly)).toBe(true);
  });

  it('sorts by the chosen order', async () => {
    const s = await setup(async () => ({ itineraries, errors: [] }));
    const body = (await s.app.inject({ url: `/api/plan?from=${FROM}&to=${TO}&sort=least-walking` })).json() as PlanResponse;
    expect(body.options[0]!.walkOnly).toBe(false);
  });

  it('plans with the built-in planner when OTP is down, and validates its input', async () => {
    const s = await setup(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const down = await s.app.inject({ url: `/api/plan?from=${FROM}&to=${TO}` });
    expect(down.statusCode).toBe(200);
    expect((down.json() as PlanResponse).messages.join(' ')).toMatch(/straight-line distance/);
    expect((await s.app.inject({ url: `/api/plan?from=1,2&to=${TO}` })).statusCode).toBe(400);
    expect((await s.app.inject({ url: `/api/plan?from=${FROM}&to=${TO}&time=soon` })).statusCode).toBe(400);
  });

  it('explains in plain words when there is nothing to ride, and offers the walk', async () => {
    const noService = [{ code: 'NO_TRANSIT_CONNECTION_IN_SEARCH_WINDOW', description: 'No trip found. There may be no transit service…' }];
    const s = await setup(async (_url, q) =>
      q.flavor === 'walk-only' ? { itineraries: [itineraries[1]!], errors: [] } : { itineraries: [], errors: noService },
    );
    const body = (await s.app.inject({ url: `/api/plan?from=${FROM}&to=${TO}` })).json() as PlanResponse;
    expect(body.options.map((o) => o.walkOnly)).toEqual([true]);
    expect(body.messages).toEqual([
      'No trains, buses or boats found around that time. Most MBTA service stops between about 1 and 5 AM; try "Leave at" a later time.',
    ]);
  });

  it('passes on an unknown OTP message as it is', async () => {
    const s = await setup(async () => ({ itineraries: [], errors: [{ code: 'SOMETHING_NEW', description: 'Something new happened.' }] }));
    const body = (await s.app.inject({ url: `/api/plan?from=${FROM}&to=${TO}` })).json() as PlanResponse;
    expect(body).toMatchObject({ options: [], messages: ['Something new happened.'] });
  });
});

describe('fares (shapes from OTP 2.10 on the MBTA feed, 2026-10-16)', () => {
  const product = (use: string, name: string, medium: string | null, amount: number) => ({
    id: use,
    product: { name, medium: medium ? { id: medium, name: medium } : null, riderCategory: null, price: { amount, currency: { code: 'USD' } } },
  });
  const rideWith = (fareProducts: unknown[]) => ({ ...itineraries[0]!.legs[1]!, fareProducts }) as OtpItinerary['legs'][number];
  const fareFor = (...rides: unknown[][]) =>
    mapItinerary({ ...itineraries[0]!, legs: rides.map(rideWith) }, { label: () => 'live', stepFree: false }).fare;

  it('quotes one tap-to-pay fare for a free subway transfer, not the $0 product', () => {
    const shared = [product('u1', 'Subway one-way fare', 'Contactless payment', 2.4), product('free', 'Free fare', null, 0), product('u3', 'Subway one-way fare', 'Cash', 2.4)];
    // Orange then Red: the contactless use is the same on both rides.
    expect(fareFor(shared, [product('u1', 'Subway one-way fare', 'Contactless payment', 2.4), product('u4', 'Subway one-way fare', 'Cash', 2.4)])).toEqual({
      cents: 240,
      label: 'Tap to pay or CharlieCard',
    });
  });

  it('charges each ride when the products are separate uses', () => {
    expect(fareFor([product('a', 'Local Bus one-way fare', 'Contactless payment', 1.7)], [product('b', 'Local Bus one-way fare', 'Contactless payment', 1.7)])?.cents).toBe(340);
  });

  it('gives no total when a ride has no price', () => {
    expect(fareFor([product('a', 'Local Bus one-way fare', 'Contactless payment', 1.7)], [])).toEqual({ cents: null, label: 'Fare unknown for part of this trip' });
  });
});

describe('place search', () => {
  const photon = (features: unknown[]) => {
    const calls: string[] = [];
    return {
      calls,
      fetch: async (url: string) => {
        calls.push(url);
        return new Response(JSON.stringify({ features }));
      },
    };
  };
  const feature = (name: string, lon: number, lat: number) => ({
    geometry: { coordinates: [lon, lat] },
    properties: { osm_id: 1, osm_type: 'N', name, street: 'Massachusetts Avenue', city: 'Cambridge' },
  });

  it('lists our stops first, then places in the MBTA area, and caches', async () => {
    const s = await stack({ start: T0 });
    const p = photon([feature('Park Street Church', -71.062, 42.3567), feature('Park Street, Springfield', -72.59, 42.1)]);
    const g = new Geocoder({ userAgent: 'test', getDb: () => s.db, fetch: p.fetch });
    const r = await g.search('park', { lat: 42.356, lon: -71.062 });
    expect(r.results.map((x) => [x.kind, x.name])).toEqual([
      ['station', 'Park Street'],
      ['place', 'Park Street Church'],
    ]);
    expect(p.calls[0]).toContain('lat=42.3560&lon=-71.0620');
    await g.search('Park ', { lat: 42.3561, lon: -71.0621 });
    expect(p.calls).toHaveLength(1);
  });

  it('still offers stops when Photon is down', async () => {
    const s = await stack({ start: T0 });
    const g = new Geocoder({ userAgent: 'test', getDb: () => s.db, fetch: async () => new Response('', { status: 502 }) });
    const r = await g.search('park', null);
    expect(r).toMatchObject({ placesAvailable: false, results: [{ name: 'Park Street' }] });
  });
});
