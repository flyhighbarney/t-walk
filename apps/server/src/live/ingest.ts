// Applies upstream events to the store and keeps track of how current each
// kind of data is. Live sources and the replay harness both call `handle`.
//
// Data age, honestly:
// - V3 stream: predictions carry no timestamp of their own, and the stream only
//   sends what changed. While connected, everything held is as current as the
//   last event received, so the age is the time since the last event.
// - GTFS-RT: the feed header's timestamp (when the MBTA produced it).
// - While a stream is reconnecting its data is kept, marked stale, until it is
//   DOWN_AFTER_SECONDS old; then it is no longer used and the schedule is shown.

import { DOWN_AFTER_SECONDS, type FeedHealth, type FeedState, type Mode, type Prediction } from '@twalk/core';
import type { Clock } from './clock.ts';
import type { StreamName, UpstreamEvent } from './events.ts';
import { alertsFromFeed, feedTimestamp, predictionsFromTripUpdates, vehiclesFromFeed } from './gtfsrt.ts';
import type { LiveStore } from './store.ts';
import { alertFromV3, predictionFromV3, vehicleFromV3, type V3Resource } from './v3.ts';

export type PredictionGroup = 'rail' | 'bus';
export const groupOfMode = (mode: Mode): PredictionGroup => (mode === 'bus' ? 'bus' : 'rail');

interface StreamState {
  connected: boolean;
  /** A reset has arrived since the connection opened. */
  synced: boolean;
  lastMessageAt: number | null;
  /** GTFS-RT: when the MBTA produced the last feed. */
  feedAt: number | null;
  closedAt: number | null;
  lastReason: string | null;
}

/** A connected V3 stream that has been quiet this long is shown as stale. */
const QUIET_STALE_MS = 45_000;
/** GTFS-RT feeds update every few seconds; older than this is stale. */
const FEED_STALE_MS = 60_000;

export class Ingest {
  private readonly streams = new Map<StreamName, StreamState>();
  private readonly store: LiveStore;
  private readonly clock: Clock;
  private readonly routeType: (routeId: string) => number | undefined;
  private readonly log: (msg: string) => void;
  private readonly replay: boolean;
  /** Bumped when any health state changes, so boards are rebuilt. */
  healthVersion = 0;

  constructor(opts: {
    store: LiveStore;
    clock: Clock;
    routeType: (routeId: string) => number | undefined;
    log?: (msg: string) => void;
    replay?: boolean;
  }) {
    this.store = opts.store;
    this.clock = opts.clock;
    this.routeType = opts.routeType;
    this.log = opts.log ?? (() => {});
    this.replay = opts.replay ?? false;
  }

  state(stream: StreamName): StreamState {
    let s = this.streams.get(stream);
    if (!s) {
      s = { connected: false, synced: false, lastMessageAt: null, feedAt: null, closedAt: null, lastReason: null };
      this.streams.set(stream, s);
    }
    return s;
  }

  handle(e: UpstreamEvent): void {
    const s = this.state(e.stream);
    if (e.kind === 'open') {
      s.connected = true;
      s.synced = false;
      s.closedAt = null;
      this.healthVersion++;
      return;
    }
    if (e.kind === 'close') {
      s.connected = false;
      s.synced = false;
      s.closedAt = e.t;
      s.lastReason = e.reason;
      this.healthVersion++;
      this.log(`${e.stream} closed: ${e.reason}`);
      return;
    }
    try {
      if (e.stream.startsWith('gtfsrt-')) this.handleFeed(e.stream, e.data, e.t);
      else this.handleV3(e.stream, e.event, e.data);
      s.lastMessageAt = e.t;
    } catch (err) {
      this.log(`${e.stream}: couldn't apply ${e.event}: ${(err as Error).message}`);
    }
  }

  private groupOf(p: Prediction): PredictionGroup {
    return this.routeType(p.routeId) === 3 ? 'bus' : 'rail';
  }

  private handleV3(stream: StreamName, event: string, data: string): void {
    const s = this.state(stream);
    const parsed = JSON.parse(data) as V3Resource | V3Resource[];
    const list = Array.isArray(parsed) ? parsed : [parsed];
    if (stream === 'predictions-rail' || stream === 'predictions-bus') {
      const group: PredictionGroup = stream === 'predictions-rail' ? 'rail' : 'bus';
      const c = this.store.predictions;
      if (event === 'reset') {
        // The real stream is back: drop what the fallback was standing in with.
        c.clearOwner(`gtfsrt:${group}`);
        c.reset(stream, list.map(predictionFromV3).filter((p): p is Prediction => p != null));
        if (!s.synced) this.healthVersion++;
        s.synced = true;
      } else if (event === 'add' || event === 'update') {
        for (const r of list) {
          const p = predictionFromV3(r);
          if (p) c.set(stream, p);
        }
      } else if (event === 'remove') {
        for (const r of list) c.delete(r.id);
      }
      return;
    }
    if (stream === 'vehicles') {
      const c = this.store.vehicles;
      if (event === 'reset') {
        c.clearOwner('gtfsrt');
        c.reset(stream, list.map(vehicleFromV3).filter((v) => v != null));
        if (!s.synced) this.healthVersion++;
        s.synced = true;
      } else if (event === 'add' || event === 'update') {
        for (const r of list) {
          const v = vehicleFromV3(r);
          if (v) c.set(stream, v);
        }
      } else if (event === 'remove') for (const r of list) c.delete(r.id);
      return;
    }
    if (stream === 'alerts') {
      const c = this.store.alerts;
      if (event === 'reset') {
        c.reset(stream, list.map(alertFromV3).filter((a) => a != null));
        if (!s.synced) this.healthVersion++;
        s.synced = true;
      } else if (event === 'add' || event === 'update') {
        for (const r of list) {
          const a = alertFromV3(r);
          if (a) c.set(stream, a);
        }
      } else if (event === 'remove') for (const r of list) c.delete(r.id);
    }
  }

  /** V3 stream for this group is connected and has its state. */
  v3Synced(stream: StreamName): boolean {
    const s = this.streams.get(stream);
    return s != null && s.connected && s.synced;
  }

  private handleFeed(stream: StreamName, data: string, t: number): void {
    const s = this.state(stream);
    s.feedAt = feedTimestamp(data) ?? t;
    if (stream === 'gtfsrt-trip-updates') {
      const byGroup: Record<PredictionGroup, Prediction[]> = { rail: [], bus: [] };
      for (const p of predictionsFromTripUpdates(data)) byGroup[this.groupOf(p)].push(p);
      for (const group of ['rail', 'bus'] as const) {
        const v3 = `predictions-${group}` as StreamName;
        if (this.v3Synced(v3)) {
          this.store.predictions.clearOwner(`gtfsrt:${group}`);
          continue;
        }
        // Stand in for the V3 stream: its stale items go, the feed's take over.
        this.store.predictions.clearOwner(v3);
        this.store.predictions.reset(`gtfsrt:${group}`, byGroup[group]);
      }
    } else if (stream === 'gtfsrt-alerts') {
      if (this.v3Synced('alerts')) {
        this.store.alerts.clearOwner('gtfsrt');
        return;
      }
      this.store.alerts.clearOwner('alerts');
      this.store.alerts.reset('gtfsrt', alertsFromFeed(data));
    } else if (stream === 'gtfsrt-vehicles') {
      if (this.v3Synced('vehicles')) {
        this.store.vehicles.clearOwner('gtfsrt');
        return;
      }
      this.store.vehicles.clearOwner('vehicles');
      this.store.vehicles.reset('gtfsrt', vehiclesFromFeed(data));
    }
  }

  private v3Health(stream: StreamName, quietOk: boolean): FeedHealth | null {
    const s = this.streams.get(stream);
    if (!s || s.lastMessageAt == null) return null;
    const now = this.clock.now();
    const source = this.replay ? 'replay' : 'v3-stream';
    if (s.connected && s.synced) {
      if (quietOk) return { source, state: 'live', lastUpdateAt: now, detail: null };
      const state: FeedState = now - s.lastMessageAt <= QUIET_STALE_MS ? 'live' : 'stale';
      return { source, state, lastUpdateAt: s.lastMessageAt, detail: state === 'stale' ? 'No updates from the MBTA recently' : null };
    }
    const lastUpdateAt = s.closedAt ?? s.lastMessageAt;
    const down = (now - lastUpdateAt) / 1000 > DOWN_AFTER_SECONDS;
    return {
      source,
      state: down ? 'down' : 'stale',
      lastUpdateAt,
      detail: 'Live stream interrupted',
    };
  }

  private feedHealth(stream: StreamName): FeedHealth | null {
    const s = this.streams.get(stream);
    if (!s || s.feedAt == null) return null;
    const now = this.clock.now();
    const age = now - s.feedAt;
    let state: FeedState = 'live';
    if (age / 1000 > DOWN_AFTER_SECONDS) state = 'down';
    else if (!s.connected || age > FEED_STALE_MS) state = 'stale';
    return { source: this.replay ? 'replay' : 'gtfs-rt', state, lastUpdateAt: s.feedAt, detail: null };
  }

  private pick(primary: FeedHealth | null, fallback: FeedHealth | null, what: string): FeedHealth {
    const rank = (h: FeedHealth | null) => (h == null ? -1 : h.state === 'live' ? 2 : h.state === 'stale' ? 1 : 0);
    if (rank(primary) === 2) return primary!;
    if (rank(fallback) > rank(primary) || (rank(fallback) === rank(primary) && (fallback?.lastUpdateAt ?? 0) > (primary?.lastUpdateAt ?? 0))) {
      return { ...fallback!, detail: primary ? "Live stream interrupted; using the MBTA's backup feed" : fallback!.detail };
    }
    if (primary) return primary;
    return { source: 'none', state: 'down', lastUpdateAt: null, detail: `No live ${what} yet` };
  }

  predictionHealth(mode: Mode): FeedHealth {
    const group = groupOfMode(mode);
    return this.pick(this.v3Health(`predictions-${group}`, false), this.feedHealth('gtfsrt-trip-updates'), 'predictions');
  }

  vehicleHealth(): FeedHealth {
    return this.pick(this.v3Health('vehicles', false), this.feedHealth('gtfsrt-vehicles'), 'vehicle positions');
  }

  alertHealth(): FeedHealth {
    return this.pick(this.v3Health('alerts', true), this.feedHealth('gtfsrt-alerts'), 'alerts');
  }

  /** For the manager: has this V3 stream been unusable for at least `ms`? */
  unsyncedFor(stream: StreamName, ms: number, since: number): boolean {
    const s = this.streams.get(stream);
    if (s?.connected && s.synced) return false;
    const from = s?.closedAt ?? since;
    return this.clock.now() - from >= ms;
  }
}
