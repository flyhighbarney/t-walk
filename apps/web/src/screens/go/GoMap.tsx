// The navigation map: your trip's route (done parts greyed), you with the way
// you're facing, and the vehicle you're waiting for or riding. In follow mode
// the camera stays on you, turned the way you're heading, tilted like the
// map apps do; touch the map and it stops following until you tap Re-center.

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { LngLatBounds, Map as MlMap, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { NavPhase, TripOption } from '@twalk/core';
import { loadBasemap, muteBasemap, prefersDark } from '../map/mapStyle.ts';

setWorkerUrl(workerUrl);

export interface GoMapProps {
  option: TripOption;
  legIndex: number;
  phase: NavPhase;
  position: { lat: number; lon: number; source: 'gps' | 'vehicle' } | null;
  /** Degrees from north, or null when unknown (no cone is drawn then). */
  heading: number | null;
  vehicle: { lat: number; lon: number; label: string; color: string; textColor: string; stale: boolean } | null;
  follow: boolean;
  onUserMove: () => void;
  /** Space taken by the banner and the sheet, so "you" sits in the clear part. */
  padding: { top: number; bottom: number };
}

function features(option: TripOption, legIndex: number, dark: boolean) {
  return {
    type: 'FeatureCollection' as const,
    features: option.legs.map((l, i) => ({
      type: 'Feature' as const,
      properties: {
        color: i < legIndex ? (dark ? '#5d6880' : '#a7b0c2') : l.transit ? `#${l.color ?? '666666'}` : '#51df8e',
        walk: !l.transit,
        current: i === legIndex,
      },
      geometry: { type: 'LineString' as const, coordinates: l.geometry.length > 1 ? l.geometry : [[l.from.lon, l.from.lat], [l.to.lon, l.to.lat]] },
    })),
  };
}

function youElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.className = 'relative flex size-20 items-center justify-center';
  // The cone points up (north) and is turned by --heading, relative to the map.
  el.innerHTML = `
    <svg data-cone class="absolute inset-0 transition-transform duration-300" viewBox="0 0 80 80" style="display:none">
      <defs><radialGradient id="cone" cx="50%" cy="100%" r="100%"><stop offset="0" stop-color="#51df8e" stop-opacity=".6"/><stop offset="1" stop-color="#51df8e" stop-opacity="0"/></radialGradient></defs>
      <path d="M40 40 L22 6 A40 40 0 0 1 58 6 Z" fill="url(#cone)"/>
    </svg>
    <span class="you-halo absolute size-10 rounded-full" style="background:#51df8e44"></span>
    <span data-dot class="relative size-5 rounded-full border-[3px] border-white" style="background:#12b76a;box-shadow:0 0 12px #51df8e"></span>`;
  return el;
}

export default function GoMap(props: GoMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const you = useRef<Marker | null>(null);
  const veh = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const dark = useRef(prefersDark()).current;
  const reducedMotion = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches).current;
  const onUserMove = useRef(props.onUserMove);
  onUserMove.current = props.onUserMove;

  useEffect(() => {
    if (!el.current) return;
    let map: MlMap | null = null;
    let cancelled = false;
    void loadBasemap(dark).then((style) => {
      if (cancelled || !el.current) return;
      try {
        map = new MlMap({ container: el.current, style, attributionControl: { compact: true }, pitchWithRotate: true });
      } catch {
        setFailed(true);
        return;
      }
      const m = map;
      mapRef.current = m;
      m.on('load', () => {
        muteBasemap(m, dark);
        m.addSource('trip', { type: 'geojson', data: features(props.option, props.legIndex, dark) });
        m.addLayer({ id: 'trip-casing', type: 'line', source: 'trip', filter: ['!', ['get', 'walk']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dark ? '#04101f' : '#ffffff', 'line-width': 11 } });
        m.addLayer({ id: 'trip-ride', type: 'line', source: 'trip', filter: ['!', ['get', 'walk']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 7 } });
        m.addLayer({ id: 'trip-walk', type: 'line', source: 'trip', filter: ['get', 'walk'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'current'], 6, 4], 'line-dasharray': [0.2, 1.6] } });
        const end = props.option.legs[props.option.legs.length - 1]!.to;
        m.addSource('end', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [end.lon, end.lat] } } });
        m.addLayer({ id: 'end', type: 'circle', source: 'end', paint: { 'circle-radius': 9, 'circle-color': '#ea4335', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
        const b = new LngLatBounds();
        for (const l of props.option.legs) for (const c of l.geometry) b.extend(c);
        if (!b.isEmpty()) m.fitBounds(b, { padding: { top: props.padding.top + 20, bottom: props.padding.bottom + 20, left: 40, right: 40 }, duration: 0 });
        setReady(true);
      });
      // Only a person's touch stops following, not our own camera moves.
      for (const ev of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const) {
        m.on(ev, (e: { originalEvent?: Event }) => {
          if (e.originalEvent) onUserMove.current();
        });
      }
    });
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Done legs turn grey as you go.
  useEffect(() => {
    if (!ready) return;
    (mapRef.current?.getSource('trip') as GeoJSONSource | undefined)?.setData(features(props.option, props.legIndex, dark));
  }, [ready, props.option, props.legIndex, dark]);

  // You.
  const pos = props.position;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    if (!pos) {
      you.current?.remove();
      you.current = null;
      return;
    }
    if (!you.current) you.current = new Marker({ element: youElement(), rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([pos.lon, pos.lat]).addTo(m);
    else you.current.setLngLat([pos.lon, pos.lat]);
    const node = you.current.getElement();
    const cone = node.querySelector<SVGElement>('[data-cone]')!;
    cone.style.display = props.heading == null ? 'none' : '';
    if (props.heading != null) cone.style.transform = `rotate(${props.heading}deg)`;
    // Riding underground, "you" is the train's last report: shown hollow.
    node.querySelector<HTMLElement>('[data-dot]')!.style.background = pos.source === 'vehicle' ? 'transparent' : '#12b76a';
  }, [ready, pos?.lat, pos?.lon, pos?.source, props.heading]); // eslint-disable-line react-hooks/exhaustive-deps

  // The vehicle you're waiting for or riding.
  const v = props.vehicle;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    if (!v) {
      veh.current?.remove();
      veh.current = null;
      return;
    }
    if (!veh.current) {
      const e = document.createElement('div');
      e.setAttribute('aria-hidden', 'true');
      e.className = 'rounded-full border-2 border-white px-2 py-0.5 text-xs font-extrabold shadow-float';
      veh.current = new Marker({ element: e }).setLngLat([v.lon, v.lat]).addTo(m);
    } else veh.current.setLngLat([v.lon, v.lat]);
    const e = veh.current.getElement();
    e.textContent = v.label;
    e.style.background = v.color;
    e.style.color = v.textColor;
    e.style.opacity = v.stale ? '0.6' : '1';
  }, [ready, v?.lat, v?.lon, v?.label, v?.color, v?.textColor, v?.stale]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow: on you, turned your way, tilted; closer when walking.
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m || !props.follow || !pos) return;
    const walking = props.phase === 'walk' || props.phase === 'arrived';
    m.easeTo({
      center: [pos.lon, pos.lat],
      bearing: props.heading ?? m.getBearing(),
      pitch: walking ? 55 : 35,
      zoom: walking ? 17.5 : props.phase === 'wait' ? 16.5 : 14.5,
      padding: { top: props.padding.top, bottom: props.padding.bottom, left: 0, right: 0 },
      duration: reducedMotion ? 0 : 900,
    });
  }, [ready, props.follow, pos?.lat, pos?.lon, props.heading, props.phase, props.padding.top, props.padding.bottom]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) {
    return <p className="bg-surface-2 absolute inset-x-6 top-1/2 rounded-2xl p-4 text-center text-sm">This device can't draw the map. The directions above and below still work.</p>;
  }
  return (
    <div className="absolute inset-0">
      <div ref={el} className="h-full w-full" role="img" aria-label="Map following you along your trip" />
    </div>
  );
}
