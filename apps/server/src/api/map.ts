// Map endpoints.
//
//   GET /api/map/lines              rail and ferry route shapes (GeoJSON), cached per feed
//   GET /api/map/lines/:routeId     one route's shapes (buses, on demand)
//   GET /api/map/stations           rail and ferry stations
//   GET /api/map/stops?bbox=        bus stops in a small box (street zoom)
//   GET /api/map/vehicles?bbox=&modes=   SSE: vehicles in view, then only changes
//   GET /api/vehicles/:id           a vehicle and its next stops
//   GET /api/bikes                  Bluebikes stations with live counts

import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  simplify,
  type BikesResponse,
  type MapStation,
  type MapVehicle,
  type Mode,
  type ShapeCollection,
  type ShapeFeature,
  type Vehicle,
  type VehicleDetail,
  type VehicleStop,
  type VehicleStreamEvent,
} from '@twalk/core';
import type { GtfsDb } from '../gtfs/db.ts';
import type { Clock } from '../live/clock.ts';
import type { BikesFeed } from '../live/bikes.ts';
import type { LiveStore } from '../live/store.ts';
import type { Boards } from './boards.ts';
import { openSse } from './sse.ts';

const MODES = new Set<Mode>(['light_rail', 'heavy_rail', 'commuter_rail', 'bus', 'ferry']);
const SIMPLIFY_M = 4;
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
const PUSH_EVERY_MS = 1_000;
const STATUS_EVERY_MS = 15_000;

export interface MapDeps {
  getDb: () => GtfsDb;
  store: LiveStore;
  boards: Boards;
  clock: Clock;
  bikes: BikesFeed | null;
}

function parseBbox(raw: unknown): [number, number, number, number] | null {
  const parts = String(raw ?? '').split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [w, s, e, n] = parts as [number, number, number, number];
  if (w >= e || s >= n || Math.abs(s) > 90 || Math.abs(n) > 90) return null;
  return [w, s, e, n];
}

export function registerMapRoutes(app: FastifyInstance, deps: MapDeps): void {
  const { store, boards, clock } = deps;
  const cache = new Map<string, { path: string; body: string; etag: string }>();

  /** Cache a computed body per GTFS database, with an ETag so browsers revalidate for free. */
  const cached = (key: string, build: (db: GtfsDb) => unknown) => {
    const db = deps.getDb();
    const hit = cache.get(key);
    if (hit && hit.path === db.path) return hit;
    const body = JSON.stringify(build(db));
    const entry = { path: db.path, body, etag: `"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"` };
    cache.set(key, entry);
    return entry;
  };
  const sendCached = (reply: FastifyReply, ifNoneMatch: string | undefined, entry: { body: string; etag: string }) => {
    reply.header('ETag', entry.etag).header('Cache-Control', 'public, max-age=3600, must-revalidate').type('application/json');
    if (ifNoneMatch === entry.etag) return reply.code(304).send();
    return reply.send(entry.body);
  };

  const shapesFor = (db: GtfsDb, routeIds: string[]): ShapeCollection => {
    const routes = db.routes();
    const features: ShapeFeature[] = [];
    for (const id of routeIds) {
      const r = routes.get(id);
      if (!r) continue;
      for (const s of db.routeShapes(id)) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: simplify(s.coords, SIMPLIFY_M).map(([x, y]) => [round5(x), round5(y)]) },
          properties: { routeId: id, shapeId: s.shapeId, directionId: s.directionId, mode: r.mode, color: r.color, sortOrder: r.sortOrder, main: s.main },
        });
      }
    }
    return { type: 'FeatureCollection', features };
  };

  app.get('/api/map/lines', (req, reply) =>
    sendCached(
      reply,
      req.headers['if-none-match'],
      cached('lines', (db) => shapesFor(db, [...db.routes().values()].filter((r) => r.mode !== 'bus' && r.listed).map((r) => r.id))),
    ),
  );

  app.get<{ Params: { routeId: string } }>('/api/map/lines/:routeId', (req, reply) => {
    const id = req.params.routeId;
    if (!deps.getDb().routes().has(id)) return reply.code(404).send({ error: 'No such route' });
    return sendCached(reply, req.headers['if-none-match'], cached(`lines:${id}`, (db) => shapesFor(db, [id])));
  });

  app.get('/api/map/stations', (req, reply) =>
    sendCached(
      reply,
      req.headers['if-none-match'],
      cached('stations', (db): MapStation[] => {
        const routes = db.routes();
        return db.railStops().map((s) => {
          const ids = s.routeIds.filter((id) => routes.get(id)?.listed);
          const first = ids.map((id) => routes.get(id)!).find((r) => r.mode !== 'bus');
          return { id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude, routeIds: ids, modes: s.modes, color: first?.color ?? '666666' };
        });
      }),
    ),
  );

  app.get<{ Querystring: { bbox?: string } }>('/api/map/stops', (req, reply) => {
    const bbox = parseBbox(req.query.bbox);
    if (!bbox) return reply.code(400).send({ error: 'bbox=west,south,east,north is required' });
    const [w, s, e, n] = bbox;
    // Street zoom only: a box this small holds at most a few hundred stops.
    if (e - w > 0.08 || n - s > 0.06) return { stops: [] };
    return { stops: deps.getDb().busStopsIn(w, s, e, n, 400) };
  });

  const toMap = (db: GtfsDb, v: Vehicle): MapVehicle | null => {
    const route = v.routeId ? db.routes().get(v.routeId) : undefined;
    if (!route || !v.routeId) return null;
    const stopPos = v.stopId ? db.stopPosition(v.stopId) : null;
    let headsign: string | null = null;
    if (v.tripId) {
      headsign = store.predictionsForTrip(v.tripId).find((p) => p.headsign)?.headsign ?? db.tripHeadsign(v.tripId);
      if (!headsign) {
        const last = store.lastPredictedStop(v.tripId);
        headsign = last ? (db.stop(db.topLevelId(last))?.name ?? null) : null;
      }
    }
    return {
      id: v.id,
      label: v.label,
      routeId: v.routeId,
      tripId: v.tripId,
      directionId: v.directionId,
      mode: route.mode,
      color: route.color,
      routeLabel: route.shortName || (route.id.startsWith('Green-') ? `Green ${route.id.slice(6)}` : route.mode === 'commuter_rail' ? 'CR' : route.longName.replace(/ Line$/, '')),
      latitude: v.latitude,
      longitude: v.longitude,
      bearing: v.bearing,
      currentStatus: v.currentStatus,
      stopId: v.stopId,
      stopLat: stopPos?.lat ?? null,
      stopLon: stopPos?.lon ?? null,
      occupancy: v.occupancy,
      updatedAt: v.updatedAt,
      headsign: headsign ?? route.directionDestinations[v.directionId ?? 0] ?? null,
      shapeId: v.tripId ? db.tripShapeId(v.tripId) : null,
    };
  };

  app.get<{ Querystring: { bbox?: string; modes?: string } }>('/api/map/vehicles', (req, reply) => {
    const bbox = parseBbox(req.query.bbox);
    if (!bbox) return reply.code(400).send({ error: 'bbox=west,south,east,north is required' });
    const modes = new Set(
      String(req.query.modes ?? [...MODES].join(','))
        .split(',')
        .filter((m): m is Mode => MODES.has(m as Mode)),
    );
    // A margin, so vehicles just off-screen are already there when you pan.
    const [w, s, e, n] = bbox;
    const padX = (e - w) * 0.25;
    const padY = (n - s) * 0.25;
    const inView = (v: Vehicle) =>
      v.revenue && v.longitude >= w - padX && v.longitude <= e + padX && v.latitude >= s - padY && v.latitude <= n + padY;

    const sse = openSse(req, reply);
    const send = (ev: VehicleStreamEvent) => sse.send(ev.type, ev);
    const sent = new Map<string, string>();
    const collect = () => {
      const db = deps.getDb();
      const now = new Map<string, MapVehicle>();
      for (const v of store.vehicles.items.values()) {
        if (!inView(v)) continue;
        const m = toMap(db, v);
        if (m && modes.has(m.mode)) now.set(m.id, m);
      }
      return now;
    };

    const first = collect();
    for (const [id, v] of first) sent.set(id, JSON.stringify(v));
    send({ type: 'snapshot', vehicles: [...first.values()], status: boards.status() });

    let lastVersion = store.version;
    let lastSend = Date.now();
    const timer = setInterval(() => {
      if (store.version === lastVersion) {
        if (Date.now() - lastSend >= STATUS_EVERY_MS) {
          send({ type: 'status', status: boards.status() });
          lastSend = Date.now();
        }
        return;
      }
      lastVersion = store.version;
      const current = collect();
      const upserts: MapVehicle[] = [];
      for (const [id, v] of current) {
        const json = JSON.stringify(v);
        if (sent.get(id) !== json) {
          sent.set(id, json);
          upserts.push(v);
        }
      }
      const removes = [...sent.keys()].filter((id) => !current.has(id));
      for (const id of removes) sent.delete(id);
      if (upserts.length || removes.length) {
        send({ type: 'diff', upserts, removes, status: boards.status() });
        lastSend = Date.now();
      }
    }, PUSH_EVERY_MS);
    sse.onClose(() => clearInterval(timer));
  });

  app.get<{ Params: { id: string } }>('/api/vehicles/:id', (req, reply) => {
    const db = deps.getDb();
    const v = store.vehicles.items.get(req.params.id);
    const map = v ? toMap(db, v) : null;
    if (!v || !map) return reply.code(404).send({ error: 'This vehicle is no longer reporting' });
    const now = clock.now();
    const stops: VehicleStop[] = (v.tripId ? store.predictionsForTrip(v.tripId) : [])
      .filter((p) => (p.arrivalTime ?? p.departureTime ?? 0) >= now - 60_000 || p.scheduleRelationship === 'SKIPPED')
      .sort((a, b) => a.stopSequence - b.stopSequence)
      .map((p) => ({
        stopId: p.stopId,
        name: db.stop(db.topLevelId(p.stopId))?.name ?? p.stopId,
        arrivalTime: p.arrivalTime,
        departureTime: p.departureTime,
        status: p.status,
        canceled: p.scheduleRelationship === 'SKIPPED' || p.scheduleRelationship === 'CANCELED',
      }));
    const body: VehicleDetail = { now, vehicle: map, route: db.routes().get(map.routeId) ?? null, stops, status: boards.status() };
    return body;
  });

  app.get('/api/bikes', async () => {
    const body: BikesResponse = {
      now: clock.now(),
      updatedAt: deps.bikes?.updatedAt ?? null,
      stations: deps.bikes?.stations() ?? [],
    };
    return body;
  });
}
