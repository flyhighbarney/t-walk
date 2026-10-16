// Three tabs don't need a router library: the path, and a way to change it.

import { useSyncExternalStore } from 'react';

export type Tab = 'now' | 'map' | 'saved';

const listeners = new Set<() => void>();
window.addEventListener('popstate', () => listeners.forEach((l) => l()));

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useLocationPath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname + location.search);
}

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (path === location.pathname + location.search) return;
  if (opts.replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  listeners.forEach((l) => l());
}

export function tabOf(path: string): Tab {
  if (path.startsWith('/map')) return 'map';
  if (path.startsWith('/saved')) return 'saved';
  return 'now';
}

/** /map?stop=place-pktrm opens that stop's sheet on the map. */
export function searchParam(path: string, name: string): string | null {
  const q = path.indexOf('?');
  return q === -1 ? null : new URLSearchParams(path.slice(q + 1)).get(name);
}
