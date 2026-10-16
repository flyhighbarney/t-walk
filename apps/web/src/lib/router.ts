// Three tabs don't need a router library: the path, and a way to change it.

import { useSyncExternalStore } from 'react';

export type Tab = 'now' | 'map' | 'trips' | 'saved';
/** Full-screen views without the tab bar: navigation, and a shared ETA. */
export type Screen = Tab | 'go' | 'share';

const listeners = new Set<() => void>();
window.addEventListener('popstate', () => listeners.forEach((l) => l()));

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useLocationPath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname + location.search);
}

export function navigate(path: string, opts: { replace?: boolean; state?: Record<string, unknown> } = {}): void {
  if (path === location.pathname + location.search) return;
  // Entries we push are marked, so an in-app Back only goes back within T-Walk.
  if (opts.replace) history.replaceState(history.state, '', path);
  else history.pushState({ twalkOpened: true, ...opts.state }, '', path);
  listeners.forEach((l) => l());
}

export function tabOf(path: string): Screen {
  if (path.startsWith('/go')) return 'go';
  if (path.startsWith('/share/')) return 'share';
  if (path.startsWith('/map')) return 'map';
  if (path.startsWith('/saved')) return 'saved';
  if (path.startsWith('/trips')) return 'trips';
  return 'now';
}

/** /map?stop=place-pktrm opens that stop's sheet on the map. */
export function searchParam(path: string, name: string): string | null {
  const q = path.indexOf('?');
  return q === -1 ? null : new URLSearchParams(path.slice(q + 1)).get(name);
}
