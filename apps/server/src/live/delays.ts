// Watches live predictions and turns them into arrival-history samples.
// For each trip+stop it remembers the first time we showed riders; when the
// prediction goes away (the vehicle has come and gone) the last time we saw is
// when it really arrived, and the gap is the delay against what was shown.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ArrivalHistory, type ArrivalSample, type Prediction } from '@twalk/core';

/** A first sighting closer than this to arrival wasn't shown early enough to count. */
const MIN_LEAD_MS = 5 * 60_000;
/** A prediction that vanishes with its time still this far off didn't arrive; it was dropped. */
const ARRIVED_WITHIN_MS = 90_000;
/** Ignore absurd gaps (a trip held or rerouted, not "running late"). */
const MAX_DELAY_S = 30 * 60;

interface Seen {
  first: number;
  firstSeenAt: number;
  last: number;
}

const timeOf = (p: Prediction) => p.arrivalTime ?? p.departureTime;

export class DelayRecorder {
  readonly history: ArrivalHistory;
  private readonly seen = new Map<string, Seen>();
  private dirty = false;

  private readonly now: () => number;

  constructor(now: () => number, history = new ArrivalHistory()) {
    this.now = now;
    this.history = history;
  }

  onSet(p: Prediction): void {
    const t = timeOf(p);
    if (t == null || p.scheduleRelationship === 'CANCELED' || p.scheduleRelationship === 'SKIPPED') {
      this.seen.delete(p.id);
      return;
    }
    const s = this.seen.get(p.id);
    if (s) s.last = t;
    else this.seen.set(p.id, { first: t, firstSeenAt: this.now(), last: t });
  }

  onDelete(p: Prediction): void {
    const s = this.seen.get(p.id);
    this.seen.delete(p.id);
    if (!s) return;
    const now = this.now();
    if (s.last - now > ARRIVED_WITHIN_MS) return;
    if (s.first - s.firstSeenAt < MIN_LEAD_MS) return;
    const delayS = (s.last - s.first) / 1000;
    if (Math.abs(delayS) > MAX_DELAY_S) return;
    this.history.record({ routeId: p.routeId, stopId: p.stopId }, { delayS, at: now } satisfies ArrivalSample);
    this.dirty = true;
  }

  save(path: string): void {
    if (!this.dirty) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(this.history.toJSON()));
    this.dirty = false;
  }

  static load(path: string, now: () => number): DelayRecorder {
    try {
      return new DelayRecorder(now, ArrivalHistory.fromJSON(JSON.parse(readFileSync(path, 'utf8'))));
    } catch {
      return new DelayRecorder(now);
    }
  }
}
