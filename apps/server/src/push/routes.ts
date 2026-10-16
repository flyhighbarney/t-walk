// GET    /api/push/key                   the server's public VAPID key (404 when push isn't set up)
// POST   /api/push/commutes              { commute, subscription } → { id }   (opt in)
// PUT    /api/push/commutes/:id          { commute }                          (edit)
// DELETE /api/push/commutes/:id                                               (opt out: forgotten)
// POST   /api/push/commutes/:id/test     send a test notification
//
// A commute's id is a random UUID known only to the device that created it.

import type { FastifyInstance } from 'fastify';
import webpush from 'web-push';
import type { Commute } from '@twalk/core';
import type { PushPayload, PushSender } from './notifier.ts';
import type { PushStore, PushSubscriptionJson } from './store.ts';

function place(p: unknown): Commute['from'] | null {
  const o = p as { name?: unknown; lat?: unknown; lon?: unknown } | null;
  if (!o || typeof o.lat !== 'number' || typeof o.lon !== 'number') return null;
  if (o.lat < 41 || o.lat > 43.5 || o.lon < -73 || o.lon > -69.5) return null;
  return { name: String(o.name ?? 'Place').slice(0, 100), lat: o.lat, lon: o.lon };
}

export function parseCommute(raw: unknown): Commute | null {
  const c = raw as Partial<Commute> | null;
  if (!c || typeof c !== 'object') return null;
  const from = place(c.from);
  const to = place(c.to);
  if (!from || !to) return null;
  if (c.mode !== 'arrive' && c.mode !== 'leave') return null;
  if (typeof c.time !== 'string' || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(c.time)) return null;
  const days = Array.isArray(c.days) ? [...new Set(c.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
  if (days.length === 0) return null;
  return {
    id: String(c.id ?? '').slice(0, 60) || 'commute',
    name: String(c.name ?? 'Commute').slice(0, 60),
    from,
    to,
    mode: c.mode,
    time: c.time,
    days,
    stepFree: c.stepFree === true,
    notify: true,
  };
}

function parseSubscription(raw: unknown): PushSubscriptionJson | null {
  const s = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!s || typeof s.endpoint !== 'string' || !s.endpoint.startsWith('https://') || s.endpoint.length > 1000) return null;
  if (typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string') return null;
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}

export class WebPushSender implements PushSender {
  constructor(vapid: { publicKey: string; privateKey: string; subject: string }) {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }
  async send(sub: PushSubscriptionJson, payload: PushPayload): Promise<'sent' | 'gone' | 'failed'> {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 15 * 60, urgency: 'high', topic: payload.tag.slice(0, 32).replace(/[^\w-]/g, '') });
      return 'sent';
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      return status === 404 || status === 410 ? 'gone' : 'failed';
    }
  }
}

export function registerPushRoutes(app: FastifyInstance, deps: { store: PushStore; sender: PushSender; publicKey: string }): void {
  app.get('/api/push/key', async () => ({ publicKey: deps.publicKey }));

  app.post<{ Body: { commute?: unknown; subscription?: unknown } }>('/api/push/commutes', async (req, reply) => {
    const commute = parseCommute(req.body?.commute);
    const sub = parseSubscription(req.body?.subscription);
    if (!commute || !sub) return reply.code(400).send({ error: 'A commute (two places in the MBTA area, a time and days) and a push subscription are required' });
    if (deps.store.all().filter((c) => c.subscription.endpoint === sub.endpoint).length >= 10) return reply.code(429).send({ error: 'Up to 10 commutes per device' });
    return { id: deps.store.add(commute, sub) };
  });

  app.put<{ Params: { id: string }; Body: { commute?: unknown } }>('/api/push/commutes/:id', async (req, reply) => {
    const commute = parseCommute(req.body?.commute);
    if (!commute) return reply.code(400).send({ error: 'Invalid commute' });
    return deps.store.update(req.params.id, commute) ? { ok: true } : reply.code(404).send({ error: 'Not found' });
  });

  app.delete<{ Params: { id: string } }>('/api/push/commutes/:id', async (req) => ({ removed: deps.store.remove(req.params.id) }));

  app.post<{ Params: { id: string } }>('/api/push/commutes/:id/test', async (req, reply) => {
    const c = deps.store.get(req.params.id);
    if (!c) return reply.code(404).send({ error: 'Not found' });
    const r = await deps.sender.send(c.subscription, {
      title: `Notifications are on for ${c.commute.name}`,
      body: "You'll hear from T-Walk about 5 minutes before it's time to leave, and earlier if a line you use is disrupted.",
      tag: `commute-${c.id}-test`,
      url: `/saved#${c.commute.id}`,
    });
    if (r === 'gone') deps.store.removeEndpoint(c.subscription.endpoint);
    return { result: r };
  });
}
