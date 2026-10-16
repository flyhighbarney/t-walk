import type { NearbyResponse, StopResponse, StopSummary, WalkPace } from '@twalk/core';
import { noteServerTime } from './live.ts';

const BASE = import.meta.env.VITE_API_BASE ?? '';

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as T;
  // Countdowns use the server's clock, not this device's (which may be off).
  const now = (body as { now?: unknown }).now;
  if (typeof now === 'number') noteServerTime(now);
  return body;
}

/**
 * Coordinates are rounded to ~11 m: plenty for walking times, and the server
 * never needs more. The server doesn't log or store them.
 */
const round = (n: number) => Math.round(n * 1e4) / 1e4;

export function fetchNearby(lat: number, lon: number, pace: WalkPace, signal?: AbortSignal) {
  return get<NearbyResponse>(`/api/nearby?lat=${round(lat)}&lon=${round(lon)}&pace=${pace}&limit=10`, signal);
}

export function fetchStop(id: string, signal?: AbortSignal) {
  return get<StopResponse>(`/api/stops/${encodeURIComponent(id)}`, signal);
}

export function searchStops(q: string, signal?: AbortSignal) {
  return get<{ stops: StopSummary[] }>(`/api/stops/search?q=${encodeURIComponent(q)}`, signal);
}

export const liveUrl = (stopIds: string[]) => `${BASE}/api/live?stops=${stopIds.map(encodeURIComponent).join(',')}`;
