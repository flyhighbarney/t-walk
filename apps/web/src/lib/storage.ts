// Per-device preferences in localStorage. Storage can be missing or throw
// (private windows, blocked site data), so every access is guarded and the app
// works without it.

import { useCallback, useState } from 'react';
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

function useStored<T>(key: string, fallback: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  const set = useCallback(
    (next: T) => {
      setValue(next);
      write(key, next);
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
