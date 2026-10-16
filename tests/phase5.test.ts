// Navigation support (the trip you're on, live) and shared ETAs.

import { describe, expect, it } from 'vitest';
import type { ShareView, TripLive } from '@twalk/core';
import { stack } from './helpers.ts';

const T0 = Date.parse('2026-10-15T08:00:00-04:00');

describe('/api/trips/:tripId/live', () => {
  it('finds the vehicle running a trip', async () => {
    const s = await stack({ scenario: 'normal', start: T0 });
    const r = (await s.app.inject({ url: '/api/trips/ADDED-1/live' })).json() as TripLive;
    expect(r.vehicle).toMatchObject({ id: 'R-1', tripId: 'ADDED-1', stopId: '70075', currentStatus: 'STOPPED_AT' });
  });

  it('answers for a trip nobody is running yet, without inventing a vehicle', async () => {
    const s = await stack({ scenario: 'normal', start: T0 });
    const r = (await s.app.inject({ url: '/api/trips/nope/live' })).json() as TripLive;
    expect(r).toMatchObject({ tripId: 'nope', vehicle: null, stops: [] });
  });
});

describe('/api/share', () => {
  it('shares an ETA, takes updates only with its token, and ends', async () => {
    const s = await stack({ start: T0 });
    const made = await s.app.inject({ method: 'POST', url: '/api/share', payload: { name: 'Test', to: 'Kendall/MIT', eta: T0 + 20 * 60_000, status: 'Walking to Park Street' } });
    const { id, token } = made.json() as { id: string; token: string };
    expect(id).toMatch(/^[\w-]{12}$/);

    const view = async () => (await s.app.inject({ url: `/api/share/${id}` })).json() as ShareView;
    expect(await view()).toMatchObject({ name: 'Test', to: 'Kendall/MIT', eta: T0 + 20 * 60_000, status: 'Walking to Park Street', arrived: false });
    // Nothing about where the person is.
    expect(Object.keys(await view()).sort()).toEqual(['arrived', 'eta', 'name', 'now', 'status', 'to', 'updatedAt']);

    const put = (tok: string) => s.app.inject({ method: 'PUT', url: `/api/share/${id}`, headers: { 'x-share-token': tok }, payload: { eta: T0 + 22 * 60_000, status: 'On the Red Line, 3 stops to go' } });
    expect((await put('wrong-token-wrong-token')).statusCode).toBe(404);
    expect((await put(token)).statusCode).toBe(200);
    expect((await view()).status).toBe('On the Red Line, 3 stops to go');

    await s.app.inject({ method: 'DELETE', url: `/api/share/${id}`, headers: { 'x-share-token': token } });
    expect((await s.app.inject({ url: `/api/share/${id}` })).statusCode).toBe(404);
  });

  it('ends on its own: 15 minutes after arriving, or after 6 hours', async () => {
    const s = await stack({ start: T0 });
    const make = async () => (await s.app.inject({ method: 'POST', url: '/api/share', payload: { to: 'Office', eta: T0 + 600_000 } })).json() as { id: string; token: string };
    const a = await make();
    const b = await make();
    await s.app.inject({ method: 'PUT', url: `/api/share/${a.id}`, headers: { 'x-share-token': a.token }, payload: { eta: T0, status: 'Arrived', arrived: true } });
    s.at(T0 + 16 * 60_000);
    expect((await s.app.inject({ url: `/api/share/${a.id}` })).statusCode).toBe(404);
    expect((await s.app.inject({ url: `/api/share/${b.id}` })).statusCode).toBe(200);
    s.at(T0 + 6 * 3600_000 + 1);
    expect((await s.app.inject({ url: `/api/share/${b.id}` })).statusCode).toBe(404);
  });

  it('refuses a share without a destination or with a far-off time', async () => {
    const s = await stack({ start: T0 });
    expect((await s.app.inject({ method: 'POST', url: '/api/share', payload: { eta: T0 } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: 'POST', url: '/api/share', payload: { to: 'X', eta: T0 + 48 * 3600_000 } })).statusCode).toBe(400);
  });
});
