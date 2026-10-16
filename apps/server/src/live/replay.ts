// Feeds a recording back through Ingest as the clock passes each event's time.
// Used by the server (REPLAY_FILE=…) and by the replay tests, which move a
// ManualClock and call `advanceTo` themselves.

import { readFileSync } from 'node:fs';
import type { Clock } from './clock.ts';
import type { UpstreamEvent } from './events.ts';
import type { Ingest } from './ingest.ts';

export function loadRecording(path: string): UpstreamEvent[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.startsWith('//'))
    .map((l) => JSON.parse(l) as UpstreamEvent)
    .sort((a, b) => a.t - b.t);
}

export class ReplayDriver {
  private next = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly events: UpstreamEvent[];
  private readonly ingest: Ingest;

  constructor(events: UpstreamEvent[], ingest: Ingest) {
    this.events = events;
    this.ingest = ingest;
  }

  get startTime(): number | null {
    return this.events[0]?.t ?? null;
  }

  get done(): boolean {
    return this.next >= this.events.length;
  }

  /** Apply every event up to and including time `t`. */
  advanceTo(t: number): number {
    let n = 0;
    while (this.next < this.events.length && this.events[this.next]!.t <= t) {
      this.ingest.handle(this.events[this.next]!);
      this.next++;
      n++;
    }
    return n;
  }

  /** Follow a running clock (server replay mode). */
  follow(clock: Clock, everyMs = 250): void {
    this.timer = setInterval(() => this.advanceTo(clock.now()), everyMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
