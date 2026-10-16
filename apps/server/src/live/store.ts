// In-memory live state: predictions, vehicles and alerts, each remembering
// which upstream stream supplied it, so a `reset` from one stream replaces only
// that stream's items (the rail and bus prediction streams, and the GTFS-RT
// fallback standing in for either, all write to the same collection).

import type { Alert, Prediction, Vehicle } from '@twalk/core';

export type Owner = string;

class Collection<T extends { id: string }> {
  readonly items = new Map<string, T>();
  private readonly owners = new Map<string, Owner>();
  private readonly byOwner = new Map<Owner, Set<string>>();
  private readonly onSet: (item: T, prev: T | undefined) => void;
  private readonly onDelete: (item: T) => void;

  constructor(onSet: (item: T, prev: T | undefined) => void = () => {}, onDelete: (item: T) => void = () => {}) {
    this.onSet = onSet;
    this.onDelete = onDelete;
  }

  set(owner: Owner, item: T): void {
    const prevOwner = this.owners.get(item.id);
    if (prevOwner !== undefined && prevOwner !== owner) this.byOwner.get(prevOwner)?.delete(item.id);
    const prev = this.items.get(item.id);
    this.items.set(item.id, item);
    this.owners.set(item.id, owner);
    let set = this.byOwner.get(owner);
    if (!set) this.byOwner.set(owner, (set = new Set()));
    set.add(item.id);
    this.onSet(item, prev);
  }

  delete(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    this.items.delete(id);
    const owner = this.owners.get(id);
    if (owner !== undefined) this.byOwner.get(owner)?.delete(id);
    this.owners.delete(id);
    this.onDelete(item);
    return true;
  }

  clearOwner(owner: Owner): number {
    const ids = [...(this.byOwner.get(owner) ?? [])];
    for (const id of ids) this.delete(id);
    return ids.length;
  }

  reset(owner: Owner, items: Iterable<T>): void {
    this.clearOwner(owner);
    for (const item of items) this.set(owner, item);
  }

  countOwned(owner: Owner): number {
    return this.byOwner.get(owner)?.size ?? 0;
  }
}

function addTo(map: Map<string, Set<string>>, key: string, id: string) {
  let s = map.get(key);
  if (!s) map.set(key, (s = new Set()));
  s.add(id);
}
function removeFrom(map: Map<string, Set<string>>, key: string, id: string) {
  const s = map.get(key);
  if (!s) return;
  s.delete(id);
  if (s.size === 0) map.delete(key);
}

export class LiveStore {
  /** Bumped on every change; boards are rebuilt when it moves. */
  version = 0;
  private readonly predByStop = new Map<string, Set<string>>();
  private readonly predByTrip = new Map<string, Set<string>>();
  private readonly predByRoute = new Map<string, Set<string>>();

  readonly predictions = new Collection<Prediction>(
    (p, prev) => {
      if (prev) this.unindex(prev);
      addTo(this.predByStop, p.stopId, p.id);
      addTo(this.predByTrip, p.tripId, p.id);
      addTo(this.predByRoute, p.routeId, p.id);
      this.version++;
    },
    (p) => {
      this.unindex(p);
      this.version++;
    },
  );
  readonly vehicles = new Collection<Vehicle>(
    () => this.version++,
    () => this.version++,
  );
  readonly alerts = new Collection<Alert>(
    () => this.version++,
    () => this.version++,
  );

  private unindex(p: Prediction) {
    removeFrom(this.predByStop, p.stopId, p.id);
    removeFrom(this.predByTrip, p.tripId, p.id);
    removeFrom(this.predByRoute, p.routeId, p.id);
  }

  predictionsAtStops(stopIds: readonly string[]): Prediction[] {
    const out: Prediction[] = [];
    for (const s of stopIds) for (const id of this.predByStop.get(s) ?? []) out.push(this.predictions.items.get(id)!);
    return out;
  }

  predictionsForTrip(tripId: string): Prediction[] {
    return [...(this.predByTrip.get(tripId) ?? [])].map((id) => this.predictions.items.get(id)!);
  }

  /** Routes with at least one prediction right now. */
  trackedRoutes(): Set<string> {
    return new Set(this.predByRoute.keys());
  }

  /** The stop of a trip's last prediction: its destination when the trip isn't in the schedule. */
  lastPredictedStop(tripId: string): string | null {
    let best: Prediction | null = null;
    for (const p of this.predictionsForTrip(tripId)) if (!best || p.stopSequence > best.stopSequence) best = p;
    return best?.stopId ?? null;
  }
}
