// Map endpoints on the fixture feed and the "normal" replay.

import { afterEach, describe, expect, it } from 'vitest';
import type { MapStation, MapVehicle, ShapeCollection, VehicleDetail, VehicleStreamEvent } from '@twalk/core';
import { BikesFeed } from '../apps/server/src/live/bikes.ts';
import { stack } from './helpers.ts';

const T0 = Date.parse('2026-10-15T08:00:00-04:00');
// Around downtown: Park Street, the bus stop and South Station.
const BBOX = '-71.08,42.33,-71.05,42.37';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

describe('map lines and stations', () => {
  it('serves rail shapes with their colour, and revalidates for free', async () => {
    const s = await stack({ start: T0 });
    const res = await s.app.inject({ url: '/api/map/lines' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ShapeCollection;
    // Rail and ferry only: the bus line is fetched on its own.
    expect(body.features.map((f) => f.properties.routeId)).toEqual(['Red']);
    expect(body.features[0]!.properties).toMatchObject({ color: 'DA291C', main: true, directionId: 0, mode: 'heavy_rail' });
    // Straight-ish runs are simplified away, the ends are kept.
    const coords = body.features[0]!.geometry.coordinates;
    expect(coords[0]).toEqual([-71.0706, 42.3612]);
    expect(coords.length).toBeLessThanOrEqual(6);
    const again = await s.app.inject({ url: '/api/map/lines', headers: { 'if-none-match': res.headers.etag as string } });
    expect(again.statusCode).toBe(304);
  });

  it('serves a bus route on demand', async () => {
    const s = await stack({ start: T0 });
    const body = (await s.app.inject({ url: '/api/map/lines/1' })).json() as ShapeCollection;
    expect(body.features[0]!.properties).toMatchObject({ routeId: '1', shapeId: 'bus1-0', color: 'FFC72C' });
    expect((await s.app.inject({ url: '/api/map/lines/nope' })).statusCode).toBe(404);
  });

  it('lists rail stations with their line colour', async () => {
    const s = await stack({ start: T0 });
    const body = (await s.app.inject({ url: '/api/map/stations' })).json() as MapStation[];
    expect(body.find((x) => x.id === 'place-pktrm')).toMatchObject({ name: 'Park Street', color: 'DA291C', routeIds: ['Red'] });
    expect(body.some((x) => x.id === 'B1')).toBe(false);
  });

  it('gives bus stops only for a street-sized box', async () => {
    const s = await stack({ start: T0 });
    expect((await s.app.inject({ url: '/api/map/stops?bbox=-71.07,42.35,-71.06,42.36' })).json().stops.map((x: { id: string }) => x.id)).toEqual(['B1']);
    expect((await s.app.inject({ url: '/api/map/stops?bbox=-72,42,-70,43' })).json().stops).toEqual([]);
    expect((await s.app.inject({ url: '/api/map/stops?bbox=1,2' })).statusCode).toBe(400);
  });
});

describe('vehicles', () => {
  it('describes a vehicle and its next stops from live predictions', async () => {
    const s = await stack({ scenario: 'normal', start: T0 });
    const res = await s.app.inject({ url: '/api/vehicles/R-2' });
    expect(res.statusCode).toBe(200);
    const d = res.json() as VehicleDetail;
    expect(d.vehicle).toMatchObject({ routeId: 'Red', mode: 'heavy_rail', color: 'DA291C', routeLabel: 'Red', tripId: 'ADDED-2' });
    // ADDED trips aren't in the schedule, so there's no shape of their own.
    expect(d.vehicle.shapeId).toBeNull();
    expect(d.stops.map((x) => x.name)).toEqual(['Park Street']);
    expect((await s.app.inject({ url: '/api/vehicles/ghost' })).statusCode).toBe(404);
  });

  it('streams vehicles in view, then only what changed', async () => {
    const s = await stack({ scenario: 'normal', start: T0 });
    await s.app.listen({ port: 0, host: '127.0.0.1' });
    close = () => s.app.close();
    const { port } = s.app.server.address() as { port: number };

    // y1 reports every 15 s in the scenario.
    setTimeout(() => s.at(T0 + 20_000), 300);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(`http://127.0.0.1:${port}/api/map/vehicles?bbox=${BBOX}&modes=heavy_rail,bus`, { signal: ac.signal });
    expect(res.headers.get('content-encoding')).toBe('gzip');
    const events: VehicleStreamEvent[] = [];
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const data = buf.slice(0, i).split('\n').find((l) => l.startsWith('data: '));
          buf = buf.slice(i + 2);
          if (data) events.push(JSON.parse(data.slice(6)) as VehicleStreamEvent);
        }
        if (events.some((e) => e.type === 'diff')) break;
      }
    } catch {
      // aborted
    } finally {
      clearTimeout(timer);
      ac.abort();
    }
    const snap = events[0];
    if (snap?.type !== 'snapshot') throw new Error('no snapshot');
    expect(snap.vehicles.map((v: MapVehicle) => v.id).sort()).toEqual(['R-1', 'R-2', 'y1']);
    expect(snap.vehicles.find((v) => v.id === 'R-1')).toMatchObject({ currentStatus: 'STOPPED_AT', stopId: '70075', stopLat: 42.356395 });
    const diff = events.find((e) => e.type === 'diff');
    if (diff?.type !== 'diff') throw new Error('no diff');
    // Only the bus that reported again; the trains didn't change.
    expect(diff.upserts.map((v) => v.id)).toEqual(['y1']);
  });

  it('filters by mode', async () => {
    const s = await stack({ scenario: 'normal', start: T0 });
    await s.app.listen({ port: 0, host: '127.0.0.1' });
    close = () => s.app.close();
    const { port } = s.app.server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/api/map/vehicles?bbox=${BBOX}&modes=bus`);
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    const snap = JSON.parse(text.split('\n').find((l) => l.startsWith('data: '))!.slice(6)) as VehicleStreamEvent;
    expect(snap.type === 'snapshot' && snap.vehicles.map((v) => v.id)).toEqual(['y1']);
  });
});

describe('Bluebikes', () => {
  const feed = () =>
    new BikesFeed({
      userAgent: 'test',
      fetch: async (url) => ({
        ok: true,
        status: 200,
        json: async () =>
          url.endsWith('station_information.json')
            ? { data: { stations: [{ station_id: 'a', name: 'Tremont St at West St', lat: 42.354, lon: -71.063, capacity: 15 }, { station_id: 'b', name: 'Gone', lat: 42.5, lon: -70.9 }] } }
            : {
                last_updated: 1792123321,
                data: {
                  stations: [
                    { station_id: 'a', num_bikes_available: 8, num_ebikes_available: 2, num_docks_available: 4, is_installed: 1, is_renting: 1, is_returning: 1, last_reported: 1792123300 },
                    // Uninstalled stations report zeros and a placeholder time.
                    { station_id: 'b', num_bikes_available: 0, num_docks_available: 0, is_installed: 0, is_renting: 0, is_returning: 0, last_reported: 86400 },
                  ],
                },
              },
      }),
    });

  it('merges stations with live counts and leaves out uninstalled ones', async () => {
    const f = feed();
    await f.loadInfo();
    await f.loadStatus();
    expect(f.updatedAt).toBe(1792123321000);
    expect(f.stations()).toEqual([
      { id: 'a', name: 'Tremont St at West St', latitude: 42.354, longitude: -71.063, capacity: 15, bikes: 8, ebikes: 2, docks: 4, renting: true, returning: true, reportedAt: 1792123300000 },
    ]);
  });

  it('serves them on /api/bikes, and an empty list when the feed is off', async () => {
    const s = await stack({ start: T0 });
    expect((await s.app.inject({ url: '/api/bikes' })).json()).toMatchObject({ updatedAt: null, stations: [] });
  });
});
