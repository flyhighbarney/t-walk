// GET /api/offline/pack?stops=a,b,c
//
// The next 24 hours of the timetable for a few stops, with what's needed to
// draw their boards: so the app can still answer "when is the next one"
// underground, clearly labelled as scheduled.

import type { FastifyInstance } from 'fastify';
import type { OfflinePack, RouteInfo } from '@twalk/core';
import type { GtfsDb } from '../gtfs/db.ts';
import type { Clock } from '../live/clock.ts';

const MAX_STOPS = 30;
const SPAN_MS = 24 * 3600_000;

export function registerOfflineRoutes(app: FastifyInstance, deps: { getDb: () => GtfsDb; clock: Clock }): void {
  app.get<{ Querystring: { stops?: string } }>('/api/offline/pack', async (req, reply) => {
    const db = deps.getDb();
    const now = deps.clock.now();
    const ids = [...new Set(String(req.query.stops ?? '').split(',').map((s) => db.topLevelId(s.trim())).filter(Boolean))].slice(0, MAX_STOPS);
    const stops: OfflinePack['stops'] = [];
    const schedules: OfflinePack['schedules'] = {};
    const routeIds = new Set<string>();
    for (const id of ids) {
      const stop = db.stop(id);
      if (!stop) continue;
      const platforms = db.platformIds(id);
      stops.push({ ...stop, platforms });
      // Only what's needed to draw a board: boarding calls.
      schedules[id] = db.schedules(platforms, now, now + SPAN_MS).filter((s) => s.pickupType !== 1);
      for (const s of schedules[id]!) routeIds.add(s.routeId);
      for (const r of stop.routeIds) routeIds.add(r);
    }
    const routes = [...routeIds].map((r) => db.routes().get(r)).filter((r): r is RouteInfo => r != null);
    reply.header('Cache-Control', 'no-store');
    const body: OfflinePack = { generatedAt: now, until: now + SPAN_MS, feedVersion: db.feedVersion, stops, routes, schedules };
    return body;
  });
}
