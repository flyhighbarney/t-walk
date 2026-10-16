// Leave-now notifications and backup plans, on a manual clock with a stand-in
// planner, weather and push sender. Also the opt-in endpoints.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { Alert, Commute, PlanResponse, TripLeg, TripOption } from '@twalk/core';
import { ManualClock } from '../apps/server/src/live/clock.ts';
import { CommuteNotifier, type PushPayload } from '../apps/server/src/push/notifier.ts';
import { registerPushRoutes } from '../apps/server/src/push/routes.ts';
import { PushStore } from '../apps/server/src/push/store.ts';
import type { PlanRequest } from '../apps/server/src/plan/planner.ts';

const at = (hhmm: string, day = '2026-10-16') => Date.parse(`${day}T${hhmm}:00-04:00`); // Fri
const SUB = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } };

const commute: Commute = {
  id: 'c1',
  name: 'Work',
  from: { name: 'Home', lat: 42.3473, lon: -71.0757 },
  to: { name: 'Office', lat: 42.3625, lon: -71.0862 },
  mode: 'arrive',
  time: '09:00',
  days: [0, 1, 2, 3, 4],
  stepFree: false,
  notify: true,
};

function ride(routeId: string, routeName: string, departs: number, over: Partial<TripLeg> = {}): TripLeg {
  return {
    mode: 'SUBWAY',
    transit: true,
    from: { name: 'Back Bay', lat: 0, lon: 0, stopId: 'BB', platform: null },
    to: { name: 'Downtown Crossing', lat: 0, lon: 0, stopId: 'DTX', platform: null },
    start: { scheduled: departs, estimated: null },
    end: { scheduled: departs + 10 * 60_000, estimated: null },
    source: 'live',
    routeId,
    routeLabel: routeName.replace(/ Line$/, ''),
    routeName,
    color: null,
    textColor: null,
    headsign: null,
    tripId: `${routeId}-${departs}`,
    distanceM: 0,
    durationS: 600,
    geometry: [],
    steps: [],
    stopsBetween: 0,
    alerts: [],
    priceCents: 240,
    stayOn: false,
    ...over,
  };
}

function option(leave: number, first: TripLeg): TripOption {
  return {
    id: String(leave),
    legs: [first],
    start: leave,
    end: first.end.scheduled + 5 * 60_000,
    durationS: 1800,
    walkS: 300,
    walkM: 400,
    transfers: 0,
    risk: { level: 'none', transfers: [] },
    fare: null,
    walkOnly: false,
    stepFree: false,
    alsoAt: [],
  };
}

function setup(opts: { alerts?: Alert[]; weather?: { tempF: number; precipChance: number; short: string } } = {}) {
  const store = new PushStore(join(mkdtempSync(join(tmpdir(), 'twalk-push-')), 'push.sqlite'));
  const clock = new ManualClock(at('07:00'));
  const sent: PushPayload[] = [];
  const requests: PlanRequest[] = [];
  let leave = at('08:20');
  const plan = async (req: PlanRequest): Promise<PlanResponse> => {
    requests.push(req);
    const opt = req.avoidRoutes?.includes('Orange')
      ? option(at('08:12'), ride('39', 'Route 39', at('08:16'), { mode: 'BUS', routeLabel: '39' }))
      : option(leave, ride('Orange', 'Orange Line', leave + 4 * 60_000));
    return { now: clock.now(), options: [opt], messages: [], live: true };
  };
  let gone = false;
  const notifier = new CommuteNotifier({
    store,
    plan,
    alerts: () => opts.alerts ?? [],
    weather: async () => (opts.weather ? { start: 0, ...opts.weather } : null),
    clock,
    sender: { send: async (_s, p) => (gone ? 'gone' : (sent.push(p), 'sent')) },
  });
  const id = store.add(commute, SUB);
  const run = async (hhmm: string, day?: string) => {
    clock.set(at(hhmm, day));
    await notifier.tick();
  };
  return {
    store,
    sent,
    requests,
    run,
    id,
    setLeave: (t: number) => (leave = t),
    goGone: () => (gone = true),
  };
}

describe('leave-now notifications', () => {
  it('sends one, five minutes before it is time to leave', async () => {
    const s = setup();
    await s.run('07:00'); // too early to even plan
    expect(s.requests).toHaveLength(0);
    await s.run('08:00');
    expect(s.sent).toHaveLength(0);
    await s.run('08:16');
    expect(s.sent).toEqual([
      { title: 'Leave in 4 min to catch the 8:24 AM Orange Line', body: 'From Back Bay; arrive about 8:39 AM.', tag: `commute-${s.id}`, url: '/saved#c1' },
    ]);
    await s.run('08:18');
    expect(s.sent).toHaveLength(1);
  });

  it('sends again only when the time moves by three minutes or more', async () => {
    const s = setup();
    await s.run('08:16');
    s.setLeave(at('08:21'));
    await s.run('08:18'); // re-planned, moved 1 min: no
    expect(s.sent).toHaveLength(1);
    s.setLeave(at('08:24'));
    await s.run('08:20'); // moved 4 min: yes
    expect(s.sent.map((p) => p.title)).toEqual([
      'Leave in 4 min to catch the 8:24 AM Orange Line',
      'Leave in 4 min to catch the 8:28 AM Orange Line',
    ]);
  });

  it('leaves earlier in the rain, and says why', async () => {
    const s = setup({ weather: { tempF: 50, precipChance: 80, short: 'Rain Showers' } });
    await s.run('08:14');
    expect(s.sent[0]).toMatchObject({ title: 'Leave in 4 min to catch the 8:24 AM Orange Line', body: 'From Back Bay; arrive about 8:39 AM. Rain likely (80%): 2 min extra.' });
  });

  it('stays quiet on days the commute does not run', async () => {
    const s = setup();
    await s.run('08:16', '2026-10-17'); // Saturday
    expect(s.requests).toHaveLength(0);
    expect(s.sent).toHaveLength(0);
  });

  it('forgets a device whose subscription has ended', async () => {
    const s = setup();
    s.goGone();
    await s.run('08:16');
    expect(s.store.all()).toEqual([]);
  });
});

describe('backup plans', () => {
  const suspension: Alert = {
    id: 'a1',
    effect: 'SUSPENSION',
    cause: 'TRACK_WORK',
    header: 'Orange Line suspended between Back Bay and Downtown Crossing',
    description: null,
    severity: 8,
    lifecycle: 'NEW',
    timeframe: null,
    activePeriods: [{ start: at('06:00'), end: at('12:00') }],
    entities: [{ route: 'Orange', activities: ['BOARD', 'EXIT', 'RIDE'] }],
    url: null,
    updatedAt: 0,
  };

  it('plans around a suspended line, tells you once, then times the leave-now to the backup', async () => {
    const s = setup({ alerts: [suspension] });
    await s.run('07:50'); // inside the backup window (from 75 min before)
    expect(s.requests.at(-1)?.avoidRoutes).toEqual(['Orange']);
    expect(s.sent).toEqual([
      {
        title: 'Orange Line suspended between Back Bay and Downtown Crossing',
        body: 'Backup for Work: 39 from Back Bay, leave by 8:12 AM, arrive about 8:31 AM.',
        tag: `commute-${s.id}-backup`,
        url: '/saved#c1',
      },
    ]);
    await s.run('07:53');
    expect(s.sent).toHaveLength(1);
    await s.run('08:08');
    expect(s.sent.at(-1)?.title).toBe('Leave in 4 min to catch the 8:16 AM 39 bus');
  });

  it('ignores alerts on lines the commute does not use', async () => {
    const s = setup({ alerts: [{ ...suspension, entities: [{ route: 'Red', activities: ['RIDE'] }] }] });
    await s.run('07:50');
    expect(s.sent).toHaveLength(0);
  });
});

describe('opt-in endpoints', () => {
  it('stores a valid commute and forgets it on request', async () => {
    const store = new PushStore(join(mkdtempSync(join(tmpdir(), 'twalk-push-')), 'push.sqlite'));
    const app = Fastify();
    const sent: PushPayload[] = [];
    registerPushRoutes(app, { store, publicKey: 'PUB', sender: { send: async (_s, p) => (sent.push(p), 'sent') } });
    expect((await app.inject({ url: '/api/push/key' })).json()).toEqual({ publicKey: 'PUB' });
    const bad = await app.inject({ method: 'POST', url: '/api/push/commutes', payload: { commute: { ...commute, time: '25:00' }, subscription: SUB } });
    expect(bad.statusCode).toBe(400);
    const far = await app.inject({ method: 'POST', url: '/api/push/commutes', payload: { commute: { ...commute, to: { name: 'NYC', lat: 40.7, lon: -74 } }, subscription: SUB } });
    expect(far.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/push/commutes', payload: { commute, subscription: SUB } });
    const { id } = ok.json() as { id: string };
    expect(store.get(id)?.commute.name).toBe('Work');
    await app.inject({ method: 'POST', url: `/api/push/commutes/${id}/test` });
    expect(sent[0]?.title).toBe('Notifications are on for Work');
    expect((await app.inject({ method: 'DELETE', url: `/api/push/commutes/${id}` })).json()).toEqual({ removed: true });
    expect(store.all()).toEqual([]);
  });
});
