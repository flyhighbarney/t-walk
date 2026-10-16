// GET /api/alerts?stops=a,b[&routes=x,y][&trip=1][&stepFree=1]
//
// Per stop: alerts for that stop (its platforms and station) and whole-line
// alerts for the lines serving it. With trip=1, one list for a trip or commute
// that uses those stops and lines together.

import type { FastifyInstance } from 'fastify';
import { alertsFor, type AlertView } from '@twalk/core';
import type { GtfsDb } from '../gtfs/db.ts';
import type { Clock } from '../live/clock.ts';
import type { Ingest } from '../live/ingest.ts';
import type { LiveStore } from '../live/store.ts';

const list = (raw: unknown, max = 40) =>
  String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);

export function registerAlertRoutes(app: FastifyInstance, deps: { getDb: () => GtfsDb; store: LiveStore; ingest: Ingest; clock: Clock }): void {
  app.get<{ Querystring: { stops?: string; routes?: string; trip?: string; stepFree?: string } }>('/api/alerts', async (req) => {
    const db = deps.getDb();
    const now = deps.clock.now();
    const stepFree = req.query.stepFree === '1';
    const alerts = [...deps.store.alerts.items.values()];
    const stopSet = (id: string) => {
      const top = db.topLevelId(id);
      return [top, id, ...db.platformIds(top)];
    };
    const health = deps.ingest.alertHealth();

    if (req.query.trip === '1') {
      const stopIds = new Set(list(req.query.stops).flatMap(stopSet));
      const routeIds = new Set(list(req.query.routes));
      return { now, health, alerts: alertsFor(alerts, { now, stopIds, routeIds, stepFree }) };
    }

    const byStop: Record<string, AlertView[]> = {};
    for (const id of list(req.query.stops)) {
      const stop = db.stop(db.topLevelId(id));
      if (!stop) continue;
      const routes = db.routes();
      const routeIds = new Set(stop.routeIds.filter((r) => routes.get(r)?.listed));
      byStop[stop.id] = alertsFor(alerts, { now, stopIds: new Set(stopSet(stop.id)), routeIds, stepFree });
    }
    return { now, health, byStop };
  });
}
