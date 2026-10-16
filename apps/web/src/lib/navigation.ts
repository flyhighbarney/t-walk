// What navigation needs from the device and the server: every GPS fix (not
// just big moves), which way you're facing, the live state of the vehicle
// you're riding, the screen kept on, and the trip in progress kept across a
// reload. Location is used only while the page is open.

import { useEffect, useRef, useState } from 'react';
import type { NavFix, NavProgress, TripLive, TripOption } from '@twalk/core';
import { apiUrl, getJson } from './api.ts';
import { usePageVisible } from './live.ts';

export type FixState = { kind: 'off' | 'locating' | 'denied' | 'unavailable' } | { kind: 'ok'; fix: NavFix; course: number | null };

/** Every fix while navigating. `course` is the direction of travel from GPS, when moving. */
export function useNavFix(enabled: boolean): FixState {
  const visible = usePageVisible();
  const [state, setState] = useState<FixState>({ kind: enabled ? 'locating' : 'off' });
  useEffect(() => {
    if (!enabled) return setState({ kind: 'off' });
    if (!('geolocation' in navigator)) return setState({ kind: 'unavailable' });
    if (!visible) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const course = c.heading != null && Number.isFinite(c.heading) && (c.speed ?? 0) > 0.6 ? c.heading : null;
        setState({ kind: 'ok', fix: { lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, at: pos.timestamp }, course });
      },
      (err) => setState((s) => (err.code === err.PERMISSION_DENIED ? { kind: 'denied' } : s.kind === 'ok' ? s : { kind: 'unavailable' })),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, visible]);
  return state;
}

type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * Compass heading, degrees from north, or null. iPhone asks permission, and only
 * from a tap: call `request` from a button. Elsewhere it starts by itself.
 */
export function useCompass(): { heading: number | null; needsPermission: boolean; request: () => void } {
  const [heading, setHeading] = useState<number | null>(null);
  const Ctor = (typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null) as OrientationCtor | null;
  const [allowed, setAllowed] = useState(() => Ctor != null && typeof Ctor.requestPermission !== 'function');
  useEffect(() => {
    if (!allowed) return;
    let last = 0;
    const onEvent = (e: DeviceOrientationEvent) => {
      const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      const h = ios ?? (e.absolute && e.alpha != null ? (360 - e.alpha) % 360 : null);
      const now = performance.now();
      if (h == null || now - last < 100) return;
      last = now;
      setHeading(Math.round(h));
    };
    const absolute = 'ondeviceorientationabsolute' in window;
    const name = absolute ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(name, onEvent as EventListener);
    return () => window.removeEventListener(name, onEvent as EventListener);
  }, [allowed]);
  return {
    heading,
    needsPermission: !allowed && Ctor != null,
    request: () => {
      void Ctor?.requestPermission?.().then((r) => setAllowed(r === 'granted')).catch(() => {});
    },
  };
}

/** The live state of one trip, every 10 s while the page is visible (every 5 s when it matters most). */
export function useTripLive(tripId: string | null, fast: boolean): { live: TripLive | null; failedAt: number | null } {
  const visible = usePageVisible();
  const [live, setLive] = useState<TripLive | null>(null);
  const [failedAt, setFailedAt] = useState<number | null>(null);
  useEffect(() => {
    setLive(null);
  }, [tripId]);
  useEffect(() => {
    if (!tripId || !visible) return;
    let stop = false;
    let timer = 0;
    const ac = new AbortController();
    const tick = () => {
      getJson<TripLive>(`/api/trips/${encodeURIComponent(tripId)}/live`, ac.signal)
        .then((r) => {
          if (stop) return;
          setLive(r);
          setFailedAt(null);
        })
        .catch(() => !stop && setFailedAt(Date.now()))
        .finally(() => {
          if (!stop) timer = window.setTimeout(tick, fast ? 5_000 : 10_000);
        });
    };
    tick();
    return () => {
      stop = true;
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [tripId, visible, fast]);
  return { live, failedAt };
}

/** Keep the screen on while navigating, where the browser allows it. */
export function useWakeLock(active: boolean): void {
  const visible = usePageVisible();
  useEffect(() => {
    if (!active || !visible || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let released = false;
    navigator.wakeLock
      .request('screen')
      .then((l) => (released ? void l.release() : (lock = l)))
      .catch(() => {});
    return () => {
      released = true;
      void lock?.release();
    };
  }, [active, visible]);
}

// ── The trip in progress ─────────────────────────────────────────────────

export interface GoSession {
  option: TripOption;
  startedAt: number;
  progress: NavProgress;
  /** Where the plan came from, to re-plan from here. */
  to: { name: string; lat: number; lon: number };
  stepFree: boolean;
  share: { id: string; token: string } | null;
}

const KEY = 'twalk.go.v1';

export function loadGo(now: number): GoSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as GoSession | null;
    // A trip that should have ended hours ago isn't resumed.
    if (!s || now - s.option.end > 3 * 3600_000) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveGo(s: GoSession | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // Not kept across a reload; navigation still works for this visit.
  }
}

// ── Sharing your ETA ─────────────────────────────────────────────────────

export async function startShare(to: string, eta: number, status: string): Promise<{ id: string; token: string }> {
  const res = await fetch(apiUrl('/api/share'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, eta, status }) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { id: string; token: string };
}

export function updateShare(share: { id: string; token: string }, eta: number, status: string, arrived: boolean): void {
  void fetch(apiUrl(`/api/share/${share.id}`), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-share-token': share.token },
    body: JSON.stringify({ eta, status, arrived }),
    keepalive: true,
  }).catch(() => {});
}

export function endShare(share: { id: string; token: string }): void {
  void fetch(apiUrl(`/api/share/${share.id}`), { method: 'DELETE', headers: { 'x-share-token': share.token }, keepalive: true }).catch(() => {});
}

export const shareLink = (id: string) => `${location.origin}/share/${id}`;

/** Ping the share at most every 30 s, or at once when the status line changes. */
export function useShareSync(share: { id: string; token: string } | null, eta: number, status: string, arrived: boolean): void {
  const last = useRef<{ at: number; status: string; eta: number } | null>(null);
  useEffect(() => {
    if (!share) return;
    const prev = last.current;
    const now = Date.now();
    if (prev && prev.status === status && now - prev.at < 30_000 && Math.abs(prev.eta - eta) < 60_000 && !arrived) return;
    last.current = { at: now, status, eta };
    updateShare(share, eta, status, arrived);
  }, [share, eta, status, arrived]);
}
