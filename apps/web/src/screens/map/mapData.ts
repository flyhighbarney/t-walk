// Data for the map: static layers fetched once (and revalidated with ETags by
// the browser), vehicles over SSE for the area in view, Bluebikes polled once a
// minute only while that layer is on and the page is visible.

import { useEffect, useRef, useState } from 'react';
import type { BikesResponse, LiveStatus, MapStation, MapVehicle, Mode, ShapeCollection, StopSummary, VehicleStreamEvent } from '@twalk/core';
import { apiUrl, getJson } from '../../lib/api.ts';
import { noteServerTime, usePageVisible } from '../../lib/live.ts';

export type Bbox = [number, number, number, number];

export function useStatic<T>(path: string | null): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (!path) return;
    const ac = new AbortController();
    getJson<T>(path, ac.signal)
      .then(setData)
      .catch(() => {});
    return () => ac.abort();
  }, [path]);
  return data;
}

export const useLines = () => useStatic<ShapeCollection>('/api/map/lines');
export const useStations = () => useStatic<MapStation[]>('/api/map/stations');

/** Bus routes' shapes, fetched as their vehicles come into view. */
export function useBusShapes(routeIds: string[]): ShapeCollection {
  const [shapes, setShapes] = useState<ShapeCollection>({ type: 'FeatureCollection', features: [] });
  const asked = useRef(new Set<string>());
  const key = [...new Set(routeIds)].sort().join(',');
  useEffect(() => {
    const todo = key.split(',').filter((id) => id && !asked.current.has(id));
    if (todo.length === 0) return;
    for (const id of todo) asked.current.add(id);
    Promise.all(todo.map((id) => getJson<ShapeCollection>(`/api/map/lines/${encodeURIComponent(id)}`).catch(() => null))).then((rs) =>
      setShapes((prev) => ({ type: 'FeatureCollection', features: [...prev.features, ...rs.flatMap((r) => r?.features ?? [])] })),
    );
  }, [key]);
  return shapes;
}

export function useBusStops(bbox: Bbox | null, zoom: number): StopSummary[] {
  const [stops, setStops] = useState<StopSummary[]>([]);
  const key = bbox && zoom >= 15.5 ? bbox.map((n) => n.toFixed(3)).join(',') : '';
  useEffect(() => {
    if (!key) {
      setStops([]);
      return;
    }
    const ac = new AbortController();
    getJson<{ stops: StopSummary[] }>(`/api/map/stops?bbox=${key}`, ac.signal)
      .then((r) => setStops(r.stops))
      .catch(() => {});
    return () => ac.abort();
  }, [key]);
  return stops;
}

export function useBikes(enabled: boolean): BikesResponse | null {
  const visible = usePageVisible();
  const [data, setData] = useState<BikesResponse | null>(null);
  useEffect(() => {
    if (!enabled || !visible) return;
    const ac = new AbortController();
    const load = () =>
      getJson<BikesResponse>('/api/bikes', ac.signal)
        .then(setData)
        .catch(() => {});
    void load();
    const t = window.setInterval(load, 60_000);
    return () => {
      ac.abort();
      window.clearInterval(t);
    };
  }, [enabled, visible]);
  return data;
}

export interface VehicleFeed {
  vehicles: Map<string, MapVehicle>;
  status: LiveStatus | null;
  connection: 'connecting' | 'open' | 'lost' | 'paused';
  /** Bumped on every change, for the animator. */
  version: number;
  changed: MapVehicle[];
}

const contains = (outer: Bbox, inner: Bbox) => inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];

/**
 * Vehicles in (and a little around) the visible area. The stream is reopened
 * only when the view leaves the area it covers, or the modes change.
 */
export function useVehicleStream(view: Bbox | null, modes: Mode[]): VehicleFeed {
  const visible = usePageVisible();
  const [feed, setFeed] = useState<VehicleFeed>({ vehicles: new Map(), status: null, connection: 'connecting', version: 0, changed: [] });
  const [area, setArea] = useState<Bbox | null>(null);
  const modeKey = [...modes].sort().join(',');

  // Cover the view plus half its size on every side, so ordinary panning stays inside it.
  useEffect(() => {
    if (!view) return;
    if (area && contains(area, view)) return;
    const w = view[2] - view[0];
    const h = view[3] - view[1];
    setArea([view[0] - w / 2, view[1] - h / 2, view[2] + w / 2, view[3] + h / 2]);
  }, [view, area]);

  useEffect(() => {
    if (!area || !modeKey) return;
    if (!visible) {
      setFeed((f) => ({ ...f, connection: 'paused' }));
      return;
    }
    const es = new EventSource(apiUrl(`/api/map/vehicles?bbox=${area.map((n) => n.toFixed(4)).join(',')}&modes=${modeKey}`));
    const apply = (ev: MessageEvent<string>) => {
      const e = JSON.parse(ev.data) as VehicleStreamEvent;
      noteServerTime(e.status.now);
      setFeed((prev) => {
        if (e.type === 'status') return { ...prev, status: e.status, connection: 'open' };
        const vehicles = e.type === 'snapshot' ? new Map<string, MapVehicle>() : new Map(prev.vehicles);
        const list = e.type === 'snapshot' ? e.vehicles : e.upserts;
        for (const v of list) vehicles.set(v.id, v);
        if (e.type === 'diff') for (const id of e.removes) vehicles.delete(id);
        return { vehicles, status: e.status, connection: 'open', version: prev.version + 1, changed: list };
      });
    };
    es.addEventListener('snapshot', apply);
    es.addEventListener('diff', apply);
    es.addEventListener('status', apply);
    es.onerror = () => setFeed((f) => ({ ...f, connection: 'lost' }));
    return () => es.close();
  }, [area, modeKey, visible]);

  return feed;
}
