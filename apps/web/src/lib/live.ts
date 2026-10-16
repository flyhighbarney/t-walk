// Live boards over server-sent events, and a clock that ticks once a second.
//
// - The connection is closed while the tab is hidden (no data, no battery) and
//   reopened when it's visible again; the server starts every connection with a
//   full snapshot, which is the catch-up.
// - Countdowns are computed here from absolute times against the server's
//   clock (offset measured from each message), so they tick with no traffic.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LiveEvent, LiveStatus, RouteInfo, StopBoard } from '@twalk/core';
import { liveUrl } from './api.ts';

export type Connection = 'connecting' | 'open' | 'lost' | 'paused';

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/** Server time minus this device's time, smoothed. */
const OFFSET_KEY = 'twalk.clock.offset.v1';
/** The last known difference is kept, so offline (nothing to ask) still uses the server's clock. */
let serverOffset = (() => {
  try {
    return Number(localStorage.getItem(OFFSET_KEY)) || 0;
  } catch {
    return 0;
  }
})();
let haveOffset = false;
const offsetListeners = new Set<() => void>();
export function noteServerTime(serverNow: number): void {
  const sample = serverNow - Date.now();
  // A big jump (first sample, or the device clock was changed) is taken as is,
  // and everything showing a time redraws at once rather than at the next tick.
  const jump = !haveOffset || Math.abs(sample - serverOffset) > 5_000;
  serverOffset = jump ? sample : serverOffset * 0.7 + sample * 0.3;
  haveOffset = true;
  try {
    localStorage.setItem(OFFSET_KEY, String(Math.round(serverOffset)));
  } catch {
    // Not kept; fine.
  }
  if (jump) for (const l of offsetListeners) l();
}
export const serverNow = () => Date.now() + serverOffset;

/** Re-renders once a second, on the second, while the page is visible. */
export function useNow(): number {
  const visible = usePageVisible();
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!visible) return;
    setNow(serverNow());
    const resync = () => setNow(serverNow());
    offsetListeners.add(resync);
    let timer: number;
    const tick = () => {
      setNow(serverNow());
      timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    return () => {
      window.clearTimeout(timer);
      offsetListeners.delete(resync);
    };
  }, [visible]);
  return now;
}

export interface LiveState {
  boards: Map<string, StopBoard>;
  routes: Map<string, RouteInfo>;
  status: LiveStatus | null;
  connection: Connection;
  /** When we last heard from our own server (epoch ms, device clock). */
  lastMessageAt: number | null;
}

export function useLiveBoards(stopIds: string[], seed?: { boards: StopBoard[]; routes: RouteInfo[]; status: LiveStatus }): LiveState {
  const visible = usePageVisible();
  const key = useMemo(() => [...new Set(stopIds)].sort().join(','), [stopIds]);
  const [state, setState] = useState<LiveState>({
    boards: new Map(),
    routes: new Map(),
    status: null,
    connection: 'connecting',
    lastMessageAt: null,
  });
  const seedRef = useRef(seed);
  seedRef.current = seed;

  // Data fetched with the nearby list shows at once, before the stream opens.
  useEffect(() => {
    const s = seedRef.current;
    if (!s) return;
    setState((prev) => {
      const boards = new Map(prev.boards);
      for (const b of s.boards) boards.set(b.stopId, b);
      const routes = new Map(prev.routes);
      for (const r of s.routes) routes.set(r.id, r);
      return { ...prev, boards, routes, status: prev.status ?? s.status };
    });
  }, [seed]);

  useEffect(() => {
    if (!key) return;
    if (!visible) {
      setState((s) => ({ ...s, connection: 'paused' }));
      return;
    }
    setState((s) => ({ ...s, connection: s.connection === 'paused' ? 'connecting' : s.connection }));
    const es = new EventSource(liveUrl(key.split(',')));
    const apply = (ev: MessageEvent<string>) => {
      const e = JSON.parse(ev.data) as LiveEvent;
      noteServerTime(e.status.now);
      setState((prev) => {
        const boards = e.type === 'snapshot' ? new Map<string, StopBoard>() : new Map(prev.boards);
        if (e.type === 'snapshot') {
          // Keep boards for stops this stream doesn't cover (none, normally).
          for (const [id, b] of prev.boards) if (!key.split(',').includes(id)) boards.set(id, b);
        }
        if (e.type !== 'status') for (const b of e.boards) boards.set(b.stopId, b);
        const routes = e.type === 'snapshot' ? new Map([...prev.routes, ...e.routes.map((r) => [r.id, r] as const)]) : prev.routes;
        return { boards, routes, status: e.status, connection: 'open', lastMessageAt: Date.now() };
      });
    };
    es.addEventListener('snapshot', apply);
    es.addEventListener('boards', apply);
    es.addEventListener('status', apply);
    es.onerror = () => setState((s) => ({ ...s, connection: 'lost' })); // EventSource retries by itself
    return () => es.close();
  }, [key, visible]);

  return state;
}
