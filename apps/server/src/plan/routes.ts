// GET /api/plan     a trip between two points (OpenTripPlanner with live data)
// GET /api/geocode  stops, addresses and places for the from/to fields

import type { FastifyInstance } from 'fastify';
import type { PlanSort, WalkPace } from '@twalk/core';
import type { Geocoder } from './geocode.ts';
import type { Planner } from './planner.ts';

const SORTS = new Set<PlanSort>(['fastest', 'least-walking', 'fewest-transfers', 'most-reliable']);
const PACES = new Set<WalkPace>(['slow', 'normal', 'fast']);

function point(raw: unknown): { lat: number; lon: number } | null {
  const [lat, lon] = String(raw ?? '').split(',').map(Number);
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // The MBTA area, with room to spare.
  if (lat < 41 || lat > 43.5 || lon < -73 || lon > -69.5) return null;
  return { lat, lon };
}

export function registerPlanRoutes(app: FastifyInstance, deps: { planner: Planner; geocoder: Geocoder; now?: () => number }): void {
  app.get<{
    Querystring: {
      from?: string;
      to?: string;
      fromName?: string;
      toName?: string;
      time?: string;
      arriveBy?: string;
      stepFree?: string;
      pace?: string;
      sort?: string;
      avoid?: string;
    };
  }>('/api/plan', async (req, reply) => {
    const q = req.query;
    const from = point(q.from);
    const to = point(q.to);
    if (!from || !to) return reply.code(400).send({ error: 'from and to are required as lat,lon in the MBTA area' });
    const time = q.time ? Date.parse(q.time) : null;
    if (q.time && Number.isNaN(time)) return reply.code(400).send({ error: 'time must be an ISO date-time' });
    const ac = new AbortController();
    req.raw.on('close', () => ac.abort());
    try {
      return await deps.planner.plan(
        {
          from: { ...from, name: q.fromName?.slice(0, 100) },
          to: { ...to, name: q.toName?.slice(0, 100) },
          time,
          arriveBy: q.arriveBy === '1' || q.arriveBy === 'true',
          stepFree: q.stepFree === '1' || q.stepFree === 'true',
          pace: PACES.has(q.pace as WalkPace) ? (q.pace as WalkPace) : 'normal',
          sort: SORTS.has(q.sort as PlanSort) ? (q.sort as PlanSort) : 'fastest',
          avoidRoutes: q.avoid
            ? q.avoid
                .split(',')
                .map((r) => r.trim())
                .filter((r) => /^[\w.-]{1,40}$/.test(r))
                .slice(0, 10)
            : undefined,
        },
        ac.signal,
      );
    } catch (err) {
      req.log.warn({ err }, 'plan failed');
      return reply.code(503).send({ error: 'Trip planning is offline right now. Live departures and the map still work.' });
    }
  });

  app.get<{ Querystring: { q?: string; near?: string } }>('/api/geocode', async (req) => ({
    now: deps.now?.() ?? Date.now(),
    ...(await deps.geocoder.search(String(req.query.q ?? ''), point(req.query.near))),
  }));
}
