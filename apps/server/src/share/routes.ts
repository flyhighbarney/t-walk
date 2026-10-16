// Share your ETA, no account needed.
//
//   POST   /api/share        { name?, to, eta, status }  → { id, token }
//   PUT    /api/share/:id    { eta, status, arrived? }   (header x-share-token)
//   DELETE /api/share/:id                                (header x-share-token)
//   GET    /api/share/:id    what the person you sent the link to sees
//
// What's shared is the expected arrival time and a short status ("On the Red
// Line, 3 stops to go"). Never your location. It's kept in memory only, and
// ends when you stop sharing, arrive (after 15 minutes), or after 6 hours.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ShareView } from '@twalk/core';
import type { Clock } from '../live/clock.ts';

const TTL_MS = 6 * 3600_000;
const AFTER_ARRIVAL_MS = 15 * 60_000;
const MAX_SHARES = 2000;

interface Share {
  id: string;
  token: string;
  name: string | null;
  to: string;
  eta: number;
  status: string;
  updatedAt: number;
  createdAt: number;
  arrivedAt: number | null;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

export class ShareStore {
  private readonly shares = new Map<string, Share>();
  private readonly clock: Clock;
  constructor(clock: Clock) {
    this.clock = clock;
  }

  private sweep(now: number): void {
    for (const [id, s] of this.shares) if (this.expired(s, now)) this.shares.delete(id);
  }

  private expired(s: Share, now: number): boolean {
    return now - s.createdAt > TTL_MS || (s.arrivedAt != null && now - s.arrivedAt > AFTER_ARRIVAL_MS);
  }

  create(input: { name: string | null; to: string; eta: number; status: string }): { id: string; token: string } | null {
    const now = this.clock.now();
    this.sweep(now);
    if (this.shares.size >= MAX_SHARES) return null;
    const id = randomBytes(9).toString('base64url');
    const token = randomBytes(18).toString('base64url');
    this.shares.set(id, { id, token, ...input, updatedAt: now, createdAt: now, arrivedAt: null });
    return { id, token };
  }

  private owned(id: string, token: string | undefined): Share | null {
    const s = this.shares.get(id);
    if (!s || !token) return null;
    const a = Buffer.from(s.token);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b) ? s : null;
  }

  update(id: string, token: string | undefined, u: { eta: number; status: string; arrived: boolean }): boolean {
    const s = this.owned(id, token);
    if (!s) return false;
    const now = this.clock.now();
    s.eta = u.eta;
    s.status = u.status;
    s.updatedAt = now;
    if (u.arrived && s.arrivedAt == null) s.arrivedAt = now;
    return true;
  }

  end(id: string, token: string | undefined): boolean {
    return this.owned(id, token) != null && this.shares.delete(id);
  }

  view(id: string): ShareView | null {
    const now = this.clock.now();
    const s = this.shares.get(id);
    if (!s || this.expired(s, now)) return null;
    return { now, name: s.name, to: s.to, eta: s.eta, status: s.status, updatedAt: s.updatedAt, arrived: s.arrivedAt != null };
  }
}

export function registerShareRoutes(app: FastifyInstance, deps: { store: ShareStore; clock: Clock }): void {
  const valid = (eta: unknown) => typeof eta === 'number' && Number.isFinite(eta) && Math.abs(eta - deps.clock.now()) < 12 * 3600_000;

  app.post<{ Body: { name?: unknown; to?: unknown; eta?: unknown; status?: unknown } }>('/api/share', { bodyLimit: 4096 }, async (req, reply) => {
    const b = req.body ?? {};
    const to = text(b.to, 100);
    if (!to || !valid(b.eta)) return reply.code(400).send({ error: 'A destination name and an expected arrival time are required' });
    const made = deps.store.create({ name: text(b.name, 30) || null, to, eta: b.eta as number, status: text(b.status, 140) });
    return made ?? reply.code(503).send({ error: 'Sharing is busy right now. Try again in a minute.' });
  });

  app.put<{ Params: { id: string }; Body: { eta?: unknown; status?: unknown; arrived?: unknown } }>('/api/share/:id', { bodyLimit: 4096 }, async (req, reply) => {
    const b = req.body ?? {};
    if (!valid(b.eta)) return reply.code(400).send({ error: 'Invalid arrival time' });
    const ok = deps.store.update(req.params.id, req.headers['x-share-token'] as string | undefined, { eta: b.eta as number, status: text(b.status, 140), arrived: b.arrived === true });
    return ok ? { ok: true } : reply.code(404).send({ error: 'Not found' });
  });

  app.delete<{ Params: { id: string } }>('/api/share/:id', async (req) => ({ ended: deps.store.end(req.params.id, req.headers['x-share-token'] as string | undefined) }));

  app.get<{ Params: { id: string } }>('/api/share/:id', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const v = deps.store.view(req.params.id);
    return v ?? reply.code(404).send({ error: 'This shared trip has ended.' });
  });
}
