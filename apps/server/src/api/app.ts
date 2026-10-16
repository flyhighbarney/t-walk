// The HTTP API the browser uses. The browser never talks to the MBTA.
//
//   GET /api/health                        feed status, for monitoring
//   GET /api/nearby?lat&lon[&radius][&pace] stops by walking time, with their boards
//   GET /api/stops/search?q=               stop search (when location is off)
//   GET /api/stops/:id                     one stop's board
//   GET /api/live?stops=a,b,c              SSE: snapshot, then only boards that changed

import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCompress from '@fastify/compress';
import {
  STATION_ENTRY_SECONDS,
  estimateWalk,
  type LiveEvent,
  type NearbyResponse,
  type NearbyStop,
  type RouteInfo,
  type StopBoard,
  type StopResponse,
  type WalkPace,
} from '@twalk/core';
import type { GtfsDb } from '../gtfs/db.ts';
import type { Clock } from '../live/clock.ts';
import type { BikesFeed } from '../live/bikes.ts';
import type { LiveStore } from '../live/store.ts';
import type { Boards } from './boards.ts';
import { registerMapRoutes } from './map.ts';
import { openSse } from './sse.ts';
import type { Planner } from '../plan/planner.ts';
import type { Geocoder } from '../plan/geocode.ts';
import { registerPlanRoutes } from '../plan/routes.ts';

export interface AppDeps {
  getDb: () => GtfsDb;
  boards: Boards;
  store: LiveStore;
  bikes?: BikesFeed | null;
  planner?: Planner | null;
  geocoder?: Geocoder | null;
  clock: Clock;
  webDist?: string | null;
  logger?: boolean;
}

const PACES = new Set<WalkPace>(['slow', 'normal', 'fast']);
const MAX_LIVE_STOPS = 40;
/** How often each live connection is checked for changed boards. */
const PUSH_EVERY_MS = 1_000;
const STATUS_EVERY_MS = 15_000;

function routesFor(db: GtfsDb, ids: Iterable<string>): RouteInfo[] {
  const routes = db.routes();
  return [...new Set(ids)].map((id) => routes.get(id)).filter((r): r is RouteInfo => r != null);
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false });
  const { boards, clock } = deps;
  // gzip/brotli for JSON and the app files. The live stream writes to the raw
  // socket (reply.hijack), so it is never buffered by this.
  await app.register(fastifyCompress, { threshold: 1024 });

  app.get('/api/health', async () => boards.status());

  registerMapRoutes(app, { getDb: deps.getDb, store: deps.store, boards, clock, bikes: deps.bikes ?? null });
  if (deps.planner && deps.geocoder) registerPlanRoutes(app, { planner: deps.planner, geocoder: deps.geocoder });

  app.get<{ Querystring: { lat?: string; lon?: string; radius?: string; limit?: string; pace?: string } }>(
    '/api/nearby',
    async (req, reply) => {
      const lat = Number(req.query.lat);
      const lon = Number(req.query.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return reply.code(400).send({ error: 'lat and lon are required' });
      }
      const radius = Math.min(Math.max(Number(req.query.radius) || 800, 100), 2000);
      const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 25);
      const pace = PACES.has(req.query.pace as WalkPace) ? (req.query.pace as WalkPace) : 'normal';
      const db = deps.getDb();
      const routes = db.routes();
      // Look at more than we return: some are dropped below.
      const candidates = db.nearby(lat, lon, radius, limit * 3);
      const stops: NearbyStop[] = [];
      const shown: StopBoard[] = [];
      for (const c of candidates) {
        const board = boards.board(c.stop.id);
        // Stops served only by unlisted routes (diversion shuttles) appear only while something runs there.
        const listed = c.stop.routeIds.some((id) => routes.get(id)?.listed);
        if (!listed && board.groups.length === 0) continue;
        const walk = estimateWalk(c.meters, pace, c.stop.isStation ? STATION_ENTRY_SECONDS : 0);
        stops.push({ ...c.stop, straightMeters: c.meters, walk, entranceName: c.entrance?.name ?? null });
        shown.push(board);
      }
      // Sorted by walking time, not distance (a station's entry time counts).
      const order = stops.map((s, i) => [s, shown[i]!] as const).sort((a, b) => a[0].walk.seconds - b[0].walk.seconds).slice(0, limit);
      const body: NearbyResponse = {
        now: clock.now(),
        stops: order.map(([s]) => s),
        boards: order.map(([, b]) => b),
        routes: routesFor(db, order.flatMap(([s]) => s.routeIds)),
        status: boards.status(),
      };
      return body;
    },
  );

  app.get<{ Querystring: { q?: string } }>('/api/stops/search', async (req) => {
    const db = deps.getDb();
    return { stops: db.search(String(req.query.q ?? ''), 20) };
  });

  app.get<{ Params: { id: string } }>('/api/stops/:id', async (req, reply) => {
    const db = deps.getDb();
    const stop = db.stop(db.topLevelId(req.params.id));
    if (!stop) return reply.code(404).send({ error: 'No such stop' });
    const body: StopResponse = {
      now: clock.now(),
      stop,
      board: boards.board(stop.id),
      routes: routesFor(db, stop.routeIds),
      status: boards.status(),
    };
    return body;
  });

  app.get<{ Querystring: { stops?: string } }>('/api/live', (req, reply) => {
    const db = deps.getDb();
    const requested = String(req.query.stops ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const ids = [...new Set(requested.map((id) => db.topLevelId(id)))]
      .filter((id) => db.stop(id) != null)
      .slice(0, MAX_LIVE_STOPS);
    if (ids.length === 0) return reply.code(400).send({ error: 'stops is required' });

    const sse = openSse(req, reply);
    const send = (event: LiveEvent) => sse.send(event.type, event);
    const sent = new Map<string, string>();

    const snapshot = ids.map((id) => {
      const b = boards.boardWithJson(id);
      sent.set(id, b.json);
      return b.board;
    });
    send({ type: 'snapshot', boards: snapshot, routes: routesFor(db, ids.flatMap((id) => db.stop(id)?.routeIds ?? [])), status: boards.status() });

    let lastStatus = Date.now();
    const timer = setInterval(() => {
      const changed = [];
      for (const id of ids) {
        const b = boards.boardWithJson(id);
        if (sent.get(id) !== b.json) {
          sent.set(id, b.json);
          changed.push(b.board);
        }
      }
      if (changed.length > 0) {
        send({ type: 'boards', boards: changed, status: boards.status() });
        lastStatus = Date.now();
      } else if (Date.now() - lastStatus >= STATUS_EVERY_MS) {
        // Also the keep-alive: proxies drop idle connections.
        send({ type: 'status', status: boards.status() });
        lastStatus = Date.now();
      }
    }, PUSH_EVERY_MS);
    sse.onClose(() => clearInterval(timer));
  });

  if (deps.webDist && existsSync(deps.webDist)) {
    await app.register(fastifyStatic, {
      root: deps.webDist,
      setHeaders: (res, path) => {
        // Hashed assets never change; the shell and service worker must revalidate.
        if (/[\\/]assets[\\/]/.test(path)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else res.header('Cache-Control', 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
