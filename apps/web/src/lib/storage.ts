// Per-device preferences in localStorage, shared across screens. Storage can
// be missing or throw (private windows, blocked site data), so every access is
// guarded and the app works without it.

import { useCallback, useSyncExternalStore } from 'react';
import type { WalkPace } from '@twalk/core';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not saved; the in-memory value still applies for this visit.
  }
}

const values = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

function useStored<T>(key: string, fallback: T): [T, (next: T) => void] {
  const subscribe = useCallback(
    (fn: () => void) => {
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(fn);
      return () => set!.delete(fn);
    },
    [key],
  );
  const get = useCallback(() => {
    if (!values.has(key)) values.set(key, read(key, fallback));
    return values.get(key) as T;
  }, [key]);
  const value = useSyncExternalStore(subscribe, get, get);
  const set = useCallback(
    (next: T) => {
      values.set(key, next);
      write(key, next);
      for (const fn of listeners.get(key) ?? []) fn();
    },
    [key],
  );
  return [value, set];
}

export function usePinnedStops(): [string[], (stopId: string) => void] {
  const [pins, setPins] = useStored<string[]>('twalk.pins.v1', []);
  const toggle = useCallback(
    (stopId: string) => setPins(pins.includes(stopId) ? pins.filter((p) => p !== stopId) : [...pins, stopId]),
    [pins, setPins],
  );
  return [pins, toggle];
}

export function useWalkPace(): [WalkPace, (pace: WalkPace) => void] {
  return useStored<WalkPace>('twalk.pace.v1', 'normal');
}

/** Whether the person has already chosen to share location here (so we don't ask on every visit). */
export function useLocationOptIn(): [boolean, (v: boolean) => void] {
  return useStored<boolean>('twalk.location.optin.v1', false);
}

/** Step-free mode: applied to trip planning (and, later, everywhere routes are chosen). */
export function useStepFree(): [boolean, (v: boolean) => void] {
  return useStored<boolean>('twalk.stepfree.v1', false);
}

export interface MapLayers {
  vehicles: boolean;
  stops: boolean;
  lines: boolean;
  bikes: boolean;
  crowding: boolean;
  modes: { subway: boolean; bus: boolean; rail: boolean; ferry: boolean };
}

export const DEFAULT_LAYERS: MapLayers = {
  vehicles: true,
  stops: true,
  lines: true,
  bikes: false,
  crowding: true,
  modes: { subway: true, bus: true, rail: true, ferry: true },
};

export function useMapLayers(): [MapLayers, (l: MapLayers) => void] {
  const [stored, set] = useStored<MapLayers>('twalk.map.layers.v1', DEFAULT_LAYERS);
  // Older saved values may miss newer keys.
  return [{ ...DEFAULT_LAYERS, ...stored, modes: { ...DEFAULT_LAYERS.modes, ...stored.modes } }, set];
}
