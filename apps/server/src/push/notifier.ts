// Leave-now notifications and backup plans for opted-in commutes.
//
// Every minute, for each commute due today, from 90 minutes before its time:
// - plan it with live data (at most every 2 minutes);
// - if an alert in effect hits a line or stop it uses (suspension, shuttle,
//   closure, detour), plan around those lines and send the backup once;
// - work out when to leave (the trip's start, a little earlier in rain or
//   snow) and, from 5 minutes before then, send "Leave in 3 min to catch the
//   8:21 Orange Line" once, again only if the time moves by 3 minutes or more.

import {
  DISRUPTIVE,
  alertsFor,
  formatClock,
  leaveMessage,
  localDate,
  nextOccurrence,
  tripSignature,
  type Alert,
  type PlanResponse,
  type TripOption,
} from '@twalk/core';
import type { Clock } from '../live/clock.ts';
import type { PlanRequest } from '../plan/planner.ts';
import type { PushStore, PushSubscriptionJson, StoredCommute } from './store.ts';
import { adviceFor, type HourWeather } from './weather.ts';

export interface PushPayload {
  title: string;
  body: string;
  /** Replaces an earlier notification with the same tag. */
  tag: string;
  url: string;
}

export interface PushSender {
  send(sub: PushSubscriptionJson, payload: PushPayload): Promise<'sent' | 'gone' | 'failed'>;
}

const WINDOW_BEFORE_MS = 90 * 60_000;
const BACKUP_FROM_MS = 75 * 60_000;
const NOTIFY_BEFORE_LEAVE_MS = 5 * 60_000;
const RESEND_SHIFT_MS = 3 * 60_000;
const REPLAN_EVERY_MS = 2 * 60_000;

export class CommuteNotifier {
  private readonly store: PushStore;
  private readonly plan: (req: PlanRequest) => Promise<PlanResponse>;
  private readonly alerts: () => Alert[];
  private readonly weather: (lat: number, lon: number, at: number) => Promise<HourWeather | null>;
  private readonly clock: Clock;
  private readonly sender: PushSender;
  private readonly log: (msg: string) => void;
  private readonly lastPlan = new Map<string, { at: number; option: TripOption | null; backup: TripOption | null; disruption: string | null }>();
  private running = false;

  constructor(opts: {
    store: PushStore;
    plan: (req: PlanRequest) => Promise<PlanResponse>;
    alerts: () => Alert[];
    weather: (lat: number, lon: number, at: number) => Promise<HourWeather | null>;
    clock: Clock;
    sender: PushSender;
    log?: (msg: string) => void;
  }) {
    this.store = opts.store;
    this.plan = opts.plan;
    this.alerts = opts.alerts;
    this.weather = opts.weather;
    this.clock = opts.clock;
    this.sender = opts.sender;
    this.log = opts.log ?? (() => {});
  }

  start(everyMs = 60_000): NodeJS.Timeout {
    const t = setInterval(() => void this.tick(), everyMs);
    t.unref();
    return t;
  }

  private async send(c: StoredCommute, payload: PushPayload): Promise<boolean> {
    const r = await this.sender.send(c.subscription, payload);
    if (r === 'gone') {
      this.log(`push: a device's subscription ended; removing its commutes`);
      this.store.removeEndpoint(c.subscription.endpoint);
    }
    return r === 'sent';
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const c of this.store.all()) {
        try {
          await this.check(c);
        } catch (err) {
          this.log(`push: commute ${c.id}: ${(err as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async check(c: StoredCommute): Promise<void> {
    const now = this.clock.now();
    const cm = c.commute;
    if (!cm.notify) return;
    const occ = nextOccurrence(cm, now, 0);
    const today = localDate(now);
    if (!occ || occ.date !== today || now < occ.at - WINDOW_BEFORE_MS) return;

    let cached = this.lastPlan.get(c.id);
    if (!cached || now - cached.at >= REPLAN_EVERY_MS) {
      const req: PlanRequest = {
        from: cm.from,
        to: cm.to,
        time: occ.at,
        arriveBy: cm.mode === 'arrive',
        stepFree: cm.stepFree,
        pace: 'normal',
        sort: 'fastest',
      };
      const res = await this.plan(req);
      const option = res.options.find((o) => o.start >= now - 60_000) ?? null;
      let backup: TripOption | null = null;
      let disruption: string | null = null;
      if (option) {
        const rides = option.legs.filter((l) => l.transit);
        const stopIds = new Set(rides.flatMap((l) => [l.from.stopId, l.to.stopId]).filter((s): s is string => !!s));
        const routeIds = new Set(rides.map((l) => l.routeId).filter((r): r is string => !!r));
        const hits = alertsFor(this.alerts(), { now, stopIds, routeIds, stepFree: cm.stepFree }).filter((a) => !a.upcoming && DISRUPTIVE.has(a.kind));
        if (hits.length > 0 && now >= occ.at - BACKUP_FROM_MS) {
          disruption = hits[0]!.header;
          const avoid = [...new Set(hits.flatMap((a) => a.routes).filter((r) => routeIds.has(r)))];
          if (avoid.length > 0) {
            const alt = await this.plan({ ...req, avoidRoutes: avoid });
            backup = alt.options.find((o) => o.start >= now - 60_000 && !o.walkOnly) ?? alt.options.find((o) => o.start >= now - 60_000) ?? null;
          }
        }
      }
      cached = { at: now, option, backup, disruption };
      this.lastPlan.set(c.id, cached);
    }

    const tag = `commute-${c.id}`;
    const url = `/saved#${cm.id}`;

    // Backup plan, once per day per disruption.
    if (cached.disruption) {
      const sig = `${cached.disruption}|${cached.backup ? tripSignature(cached.backup) : 'none'}`;
      if (c.lastBackup?.date !== today || c.lastBackup.signature !== sig) {
        const b = cached.backup;
        const first = b?.legs.find((l) => l.transit);
        const body = b
          ? `Backup for ${cm.name}: ${first ? `${first.routeLabel} from ${first.from.name}` : 'walk'}, leave by ${formatClock(b.start).full}, arrive about ${formatClock(b.end).full}.`
          : `This affects ${cm.name}. There's no good way around it; allow extra time.`;
        if (await this.send(c, { title: cached.disruption.slice(0, 120), body, tag: `${tag}-backup`, url })) {
          this.store.markBackup(c.id, { date: today, signature: sig });
          this.log(`push: backup sent for commute ${c.id}`);
        }
      }
    }

    const best = cached.backup ?? cached.option;
    if (!best) return;
    const advice = adviceFor(await this.weather(cm.from.lat, cm.from.lon, best.start));
    const leaveAt = best.start - advice.extraMin * 60_000;
    if (now < leaveAt - NOTIFY_BEFORE_LEAVE_MS || now > leaveAt + 60_000) return;
    const signature = tripSignature(best);
    const last = c.lastLeave;
    const changed = !last || last.date !== today || Math.abs(last.leaveAt - leaveAt) >= RESEND_SHIFT_MS;
    if (!changed) return;
    const msg = leaveMessage({ ...best, start: leaveAt }, now, { weatherNote: advice.note });
    if (await this.send(c, { title: msg.title, body: msg.body, tag, url })) {
      this.store.markLeave(c.id, { date: today, leaveAt, signature });
      this.log(`push: leave-now sent for commute ${c.id}`);
    }
  }
}
