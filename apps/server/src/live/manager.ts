// Starts the upstream sources and switches the fallback on and off.
//
// - With MBTA_API_KEY: four V3 streams (rail predictions, bus predictions,
//   vehicles, alerts). Each counts as one request against the rate limit for
//   as long as it stays open. If a prediction or vehicle stream can't be used
//   for 20 s, the GTFS-RT poller starts and stands in for it; it stops again
//   once every V3 stream has been back for a minute.
// - Without a key: GTFS-RT only (no alerts; the V3 API refuses anonymous streams).

import type { Clock } from './clock.ts';
import type { EventSink, StreamName, UpstreamEvent } from './events.ts';
import { FeedPoller } from './gtfsrt.ts';
import type { Ingest } from './ingest.ts';
import type { Recorder } from './recorder.ts';
import { SseStream } from './sse.ts';
import { v3StreamSpecs } from './v3.ts';

const FALLBACK_AFTER_MS = 20_000;
const FALLBACK_RELEASE_MS = 60_000;

export class LiveManager {
  private readonly sse: SseStream[] = [];
  private readonly pollers: Record<'gtfsrt-trip-updates' | 'gtfsrt-vehicles' | 'gtfsrt-alerts', FeedPoller>;
  private timer: NodeJS.Timeout | null = null;
  private readonly startedAt: number;
  private healthySince: number | null = null;
  private readonly opts: {
    apiKey: string | null;
    userAgent: string;
    clock: Clock;
    ingest: Ingest;
    routesByType: Map<number, string[]>;
    recorder?: Recorder | null;
    log: (msg: string) => void;
  };
  readonly sink: EventSink;

  constructor(opts: LiveManager['opts']) {
    this.opts = opts;
    this.startedAt = opts.clock.now();
    this.sink = (e: UpstreamEvent) => {
      opts.recorder?.write(e);
      opts.ingest.handle(e);
    };
    const poller = (stream: 'gtfsrt-trip-updates' | 'gtfsrt-vehicles' | 'gtfsrt-alerts', intervalMs?: number) =>
      new FeedPoller({ stream, sink: this.sink, clock: opts.clock, userAgent: opts.userAgent, intervalMs });
    this.pollers = {
      'gtfsrt-trip-updates': poller('gtfsrt-trip-updates'),
      'gtfsrt-vehicles': poller('gtfsrt-vehicles'),
      // Alerts change slowly; once every 30 s is plenty.
      'gtfsrt-alerts': poller('gtfsrt-alerts', 30_000),
    };
  }

  start(): void {
    const { apiKey, clock, userAgent, log } = this.opts;
    if (!apiKey) {
      log('No MBTA_API_KEY: using the public GTFS-realtime feeds only (polled, no streaming).');
      this.pollers['gtfsrt-trip-updates'].start();
      this.pollers['gtfsrt-vehicles'].start();
      this.pollers['gtfsrt-alerts'].start();
      return;
    }
    for (const spec of v3StreamSpecs(this.opts.routesByType)) {
      const s = new SseStream({
        stream: spec.stream,
        url: spec.url,
        headers: { 'X-API-Key': apiKey, 'User-Agent': userAgent },
        sink: this.sink,
        clock,
        silenceMs: spec.silenceMs,
        log,
      });
      s.start();
      this.sse.push(s);
    }
    this.timer = setInterval(() => this.checkFallback(), 5_000);
    this.timer.unref();
  }

  private checkFallback(): void {
    const { ingest, clock, log } = this.opts;
    const need = (streams: StreamName[]) => streams.some((s) => ingest.unsyncedFor(s, FALLBACK_AFTER_MS, this.startedAt));
    const predNeeded = need(['predictions-rail', 'predictions-bus']);
    const vehNeeded = need(['vehicles']);
    const alertsNeeded = need(['alerts']);
    const allSynced = ['predictions-rail', 'predictions-bus', 'vehicles', 'alerts'].every((s) => ingest.v3Synced(s as StreamName));
    this.healthySince = allSynced ? (this.healthySince ?? clock.now()) : null;
    const release = this.healthySince != null && clock.now() - this.healthySince >= FALLBACK_RELEASE_MS;

    for (const [stream, needed] of [
      ['gtfsrt-trip-updates', predNeeded],
      ['gtfsrt-vehicles', vehNeeded],
      ['gtfsrt-alerts', alertsNeeded],
    ] as const) {
      const p = this.pollers[stream];
      if (needed && !p.running) {
        log(`${stream}: V3 stream unavailable, starting the GTFS-realtime fallback`);
        p.start();
      } else if (!needed && p.running && release) {
        log(`${stream}: V3 stream healthy again, stopping the fallback`);
        p.stop();
      }
    }
  }

  stop(): void {
    for (const s of this.sse) s.stop();
    for (const p of Object.values(this.pollers)) p.stop();
    if (this.timer) clearInterval(this.timer);
  }
}
