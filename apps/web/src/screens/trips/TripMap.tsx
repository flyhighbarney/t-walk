// A small map of one trip: walks dotted, rides in their line's colour.
// Lazy-loaded with MapLibre, only when a trip's detail is opened.

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { LngLatBounds, Map as MlMap, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { TripOption } from '@twalk/core';
import { loadBasemap, muteBasemap, prefersDark } from '../map/mapStyle.ts';

setWorkerUrl(workerUrl);

export default function TripMap({ option }: { option: TripOption }) {
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!el.current) return;
    const dark = prefersDark();
    let map: MlMap | null = null;
    let cancelled = false;
    void loadBasemap(dark).then((style) => {
      if (cancelled || !el.current) return;
      try {
        map = new MlMap({ container: el.current, style, attributionControl: { compact: true }, interactive: true, dragRotate: false });
      } catch {
        setFailed(true);
        return;
      }
      const m = map;
      m.on('load', () => {
        muteBasemap(m, dark);
        // Attribution starts folded to its (i) button, so it doesn't cover the map.
        el.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
        const features = option.legs.map((l) => ({
          type: 'Feature' as const,
          properties: { color: l.transit ? `#${l.color ?? '666666'}` : dark ? '#51df8e' : '#006d3c', walk: !l.transit },
          geometry: { type: 'LineString' as const, coordinates: l.geometry.length > 1 ? l.geometry : [[l.from.lon, l.from.lat], [l.to.lon, l.to.lat]] },
        }));
        m.addSource('trip', { type: 'geojson', data: { type: 'FeatureCollection', features } });
        m.addLayer({ id: 'trip-ride', type: 'line', source: 'trip', filter: ['!', ['get', 'walk']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 6 } });
        m.addLayer({ id: 'trip-walk', type: 'line', source: 'trip', filter: ['get', 'walk'], layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [1, 2] } });
        const ends = {
          type: 'FeatureCollection' as const,
          features: [option.legs[0]!.from, option.legs[option.legs.length - 1]!.to].map((p, i) => ({
            type: 'Feature' as const,
            properties: { end: i === 1 },
            geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
          })),
        };
        m.addSource('ends', { type: 'geojson', data: ends });
        m.addLayer({ id: 'ends', type: 'circle', source: 'ends', paint: { 'circle-radius': 7, 'circle-color': ['case', ['get', 'end'], '#12b76a', '#ffffff'], 'circle-stroke-color': '#0a0a0a', 'circle-stroke-width': 2 } });
        const b = new LngLatBounds();
        for (const f of features) for (const c of f.geometry.coordinates) b.extend(c as [number, number]);
        m.fitBounds(b, { padding: 32, duration: 0 });
      });
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [option]);
  if (failed) return null;
  return <div ref={el} className="h-56 w-full overflow-hidden rounded-2xl" role="img" aria-label="Map of this trip's route" />;
}
