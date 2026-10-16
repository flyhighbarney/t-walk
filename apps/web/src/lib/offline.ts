// Offline mode. While online, the app keeps a day of timetable for your saved
// stops and the stops near you (refreshed every few hours) in IndexedDB.
// Without a connection, boards are built here from that timetable with the
// same rules as the server, and every time is labelled scheduled.

import { useEffect, useMemo, useState } from 'react';
import {
  buildDepartures,
  estimateWalk,
  haversineMeters,
  STATION_ENTRY_SECONDS,
  type FeedHealth,
  type NearbyStop,
  type OfflinePack,
  type StopBoard,
  type WalkPace,
} from '@twalk/core';
import { getJson } from './api.ts';
import { serverNow } from './live.ts';

const DB = 'twalk';
const STORE = 'kv';
const KEY = 'offline-pack';
const REFRESH_MS = 3 * 3600_000;

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => resolve((r.result as T) ?? null);
      r.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // No storage (private window): offline mode just isn't available.
  }
}

let memory: OfflinePack | null = null;
const listeners = new Set<(p: OfflinePack | null) => void>();

export async function loadPack(): Promise<OfflinePack | null> {
  if (!memory) memory = await idbGet<OfflinePack>(KEY);
  return memory;
}

/** Fetch and keep a fresh pack for these stops (merged with the stops already kept). */
export async function refreshPack(stopIds: string[], force = false): Promise<void> {
  const current = await loadPack();
  const have = new Set(current?.stops.map((s) => s.id) ?? []);
  const wanted = [...new Set([...stopIds, ...have])].slice(0, 30);
  const fresh = current && Date.now() - current.generatedAt < REFRESH_MS && stopIds.every((id) => have.has(id));
  if (wanted.length === 0 || (fresh && !force)) return;
  try {
    const pack = await getJson<OfflinePack>(`/api/offline/pack?stops=${encodeURIComponent(wanted.join(','))}`);
    memory = pack;
    await idbSet(KEY, pack);
    for (const l of listeners) l(pack);
  } catch {
    // Offline or server unreachable: keep what we have.
  }
}

export function usePack(): OfflinePack | null {
  const [pack, setPack] = useState<OfflinePack | null>(memory);
  useEffect(() => {
    void loadPack().then(setPack);
    listeners.add(setPack);
    return () => {
      listeners.delete(setPack);
    };
  }, []);
  return pack;
}

/** Keep the pack current for these stops while online. */
export function useKeepOffline(stopIds: string[]): void {
  const key = [...new Set(stopIds)].sort().join(',');
  useEffect(() => {
    if (!key || !navigator.onLine) return;
    const t = window.setTimeout(() => void refreshPack(key.split(',')), 3000);
    return () => window.clearTimeout(t);
  }, [key]);
}

const OFFLINE_HEALTH: FeedHealth = { source: 'none', state: 'down', lastUpdateAt: null, detail: 'Offline: timetable only' };

/** Boards from the kept timetable, rebuilt every 30 s (scheduled times only). */
export function useOfflineBoards(stopIds: string[], enabled: boolean): Map<string, StopBoard> {
  const pack = usePack();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [enabled]);
  const key = stopIds.join(',');
  return useMemo(() => {
    const out = new Map<string, StopBoard>();
    if (!enabled || !pack) return out;
    const now = serverNow();
    const routes = new Map(pack.routes.map((r) => [r.id, r]));
    for (const id of stopIds) {
      const stop = pack.stops.find((s) => s.id === id);
      if (!stop) continue;
      const groups = buildDepartures({
        now,
        routes,
        predictions: [],
        schedules: pack.schedules[id] ?? [],
        vehicles: new Map(),
        stopIds: new Set(stop.platforms),
        tripHeadsign: () => null,
        trackedRoutes: new Set(),
        health: OFFLINE_HEALTH,
      });
      out.set(id, { stopId: id, groups, generatedAt: now });
    }
    return out;
    // tick re-runs this every 30 s so times that pass drop off.
  }, [enabled, pack, key, tick]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Nearby stops from the kept timetable, when the server can't be reached. */
export function offlineNearby(pack: OfflinePack | null, lat: number, lon: number, pace: WalkPace): NearbyStop[] {
  if (!pack) return [];
  return pack.stops
    .map((s) => {
      const m = haversineMeters(lat, lon, s.latitude, s.longitude);
      return { ...s, straightMeters: m, walk: estimateWalk(m, pace, s.isStation ? STATION_ENTRY_SECONDS : 0), entranceName: null };
    })
    .filter((s) => s.straightMeters < 1500)
    .sort((a, b) => a.walk.seconds - b.walk.seconds)
    .slice(0, 10);
}

/** True while the browser says it's offline. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
