// The live map. Layout follows the Stitch "Map" design: search and live status
// on top, mode chips, map controls on the right, the nearest station docked at
// the bottom, sheets for vehicles, stops, Bluebikes and layers. The open sheet
// is in the URL (?stop=, ?vehicle=, ?bike=, ?sheet=), so Back closes it.

import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map as MlMap, Marker, setWorkerUrl, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl';
// MapLibre looks for its worker next to its own file, which the bundler renames; point it at the emitted one.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import {
  DETOUR_FACTOR,
  WALK_SPEED,
  canMakeIt,
  displayPrediction,
  displayScheduled,
  formatAge,
  rowLeavesAt,
  staleAfterSeconds,
  type MapVehicle,
  type Mode,
  type NearbyResponse,
  type StopSummary,
} from '@twalk/core';
import { AppHeader } from '../../components/Shell.tsx';
import { CloseIcon, LayersIcon, ListIcon, LocateIcon, SearchIcon, WarnIcon, BikeIcon, BusIcon, FerryIcon, TrainIcon } from '../../components/icons.tsx';
import { fetchNearby, searchStops } from '../../lib/api.ts';
import { serverNow, useNow, usePageVisible } from '../../lib/live.ts';
import { useLocation } from '../../lib/location.ts';
import { navigate, searchParam } from '../../lib/router.ts';
import { useLocationOptIn, useMapLayers, usePinnedStops, useWalkPace, type MapLayers } from '../../lib/storage.ts';
import { useBikes, useBusShapes, useBusStops, useLines, useStations, useVehicleStream, type Bbox } from './mapData.ts';
import { addVehicleImages, loadBasemap, BIKE_COLOR, lineColor, MAP_COLORS, muteBasemap, prefersDark, vehicleIconExpression } from './mapStyle.ts';
import { BikeSheet, FilterChip, InViewSheet, LayersSheet, StopSheet } from './OtherSheets.tsx';
import { VehicleAnimator } from './vehicleAnimator.ts';
import { VehicleSheet } from './VehicleSheet.tsx';

setWorkerUrl(workerUrl);

const DOWNTOWN: [number, number] = [-71.0603, 42.3555];
const EMPTY = { type: 'FeatureCollection' as const, features: [] };
/** Buses only from street-level zoom: there are hundreds of them. */
const BUS_MIN_ZOOM = 12.5;
const FRAME_MS = 50;

type Sheet =
  | { kind: 'vehicle'; id: string }
  | { kind: 'stop'; id: string }
  | { kind: 'bike'; id: string }
  | { kind: 'layers' }
  | { kind: 'list' }
  | null;

const MODE_CHIPS: { key: keyof MapLayers['modes']; label: string; Icon: typeof TrainIcon }[] = [
  { key: 'subway', label: 'Subway', Icon: TrainIcon },
  { key: 'bus', label: 'Bus', Icon: BusIcon },
  { key: 'rail', label: 'Commuter Rail', Icon: TrainIcon },
  { key: 'ferry', label: 'Ferry', Icon: FerryIcon },
];

function sheetFrom(path: string): Sheet {
  for (const kind of ['vehicle', 'stop', 'bike'] as const) {
    const id = searchParam(path, kind);
    if (id) return { kind, id };
  }
  const s = searchParam(path, 'sheet');
  return s === 'layers' || s === 'list' ? { kind: s } : null;
}

/** Each sheet is a history step (marked, so closing one goes back only over our own steps). */
function openSheet(s: Sheet): void {
  if (!s) return closeSheetStep();
  const path = s.kind === 'layers' || s.kind === 'list' ? `/map?sheet=${s.kind}` : `/map?${s.kind}=${encodeURIComponent(s.id)}`;
  navigate(path, { state: { mapSheet: true } });
}

function closeSheetStep(): void {
  if ((history.state as { mapSheet?: boolean } | null)?.mapSheet) history.back();
  else navigate('/map', { replace: true });
}

function modesFor(layers: MapLayers, zoom: number): Mode[] {
  const m: Mode[] = [];
  if (layers.modes.subway) m.push('heavy_rail', 'light_rail');
  if (layers.modes.bus && zoom >= BUS_MIN_ZOOM) m.push('bus');
  if (layers.modes.rail) m.push('commuter_rail');
  if (layers.modes.ferry) m.push('ferry');
  return m;
}

function circlePolygon(lon: number, lat: number, radiusM: number) {
  const coords: [number, number][] = [];
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    coords.push([lon + (Math.cos(a) * radiusM) / kx, lat + (Math.sin(a) * radiusM) / 110_574]);
  }
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [coords] } };
}

export default function MapScreen({ path }: { path: string }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const animator = useRef(new VehicleAnimator());
  const youMarker = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<{ bbox: Bbox; zoom: number; center: { lat: number; lon: number } } | null>(null);
  const sheet = useMemo(() => sheetFrom(path), [path]);
  const setSheet = openSheet;
  const [layers, setLayers] = useMapLayers();
  const [pins, togglePin] = usePinnedStops();
  const [pace] = useWalkPace();
  const [optIn, setOptIn] = useLocationOptIn();
  const location = useLocation(optIn);
  const [pitched, setPitched] = useState(false);
  const [bannerClosed, setBannerClosed] = useState(false);
  const visible = usePageVisible();
  const now = useNow();
  const dark = useMemo(prefersDark, []);
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  const lines = useLines();
  const stations = useStations();
  const zoom = view?.zoom ?? 14;
  const modes = useMemo(() => modesFor(layers, zoom), [layers, zoom]);
  const feed = useVehicleStream(view?.bbox ?? null, layers.vehicles ? modes : []);
  const busRoutes = useMemo(
    () => (zoom >= BUS_MIN_ZOOM ? [...feed.vehicles.values()].filter((v) => v.mode === 'bus').map((v) => v.routeId) : []),
    [feed.vehicles, zoom],
  );
  const busShapes = useBusShapes(busRoutes);
  const busStops = useBusStops(view?.bbox ?? null, zoom);
  const bikes = useBikes(layers.bikes);

  // ── Create the map once ────────────────────────────────────────────────
  const [mapError, setMapError] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    let map: MlMap;
    let cancelled = false;
    let cleanup = () => {};
    void loadBasemap(dark).then((style) => {
      if (cancelled || !container.current) return;
      try {
        map = new MlMap({
          container: container.current,
          style,
          center: DOWNTOWN,
          zoom: 14,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
        });
      } catch {
        // No WebGL: the list of what's around still works.
        setMapError(true);
        setView({ bbox: [DOWNTOWN[0] - 0.012, DOWNTOWN[1] - 0.012, DOWNTOWN[0] + 0.012, DOWNTOWN[1] + 0.012], zoom: 14, center: { lat: DOWNTOWN[1], lon: DOWNTOWN[0] } });
        return;
      }
      cleanup = setup(map);
    });
    const setup = (map: MlMap) => {
    mapRef.current = map;
    // For debugging in a browser console: localStorage.twalkDebug = '1'.
    try {
      if (localStorage.getItem('twalkDebug')) (window as unknown as { twalkMap: MlMap }).twalkMap = map;
    } catch {
      // No storage: no debug handle.
    }
    animator.current.reducedMotion = reducedMotion;
    const report = () => {
      const b = map.getBounds();
      const c = map.getCenter();
      setView({ bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], zoom: map.getZoom(), center: { lat: c.lat, lon: c.lng } });
    };
    map.on('load', () => {
      muteBasemap(map, dark);
      addVehicleImages(map);
      const c = dark ? MAP_COLORS.dark : MAP_COLORS.light;
      map.addSource('walk', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'walk-fill', type: 'fill', source: 'walk', paint: { 'fill-color': '#51df8e', 'fill-opacity': 0.07 } });
      map.addLayer({ id: 'walk-line', type: 'line', source: 'walk', paint: { 'line-color': '#51df8e', 'line-width': 1.4, 'line-dasharray': [3, 3] } });
      map.addSource('lines', { type: 'geojson', data: EMPTY });
      map.addSource('bus-lines', { type: 'geojson', data: EMPTY });
      const width = ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 5, 17, 9] as const;
      map.addLayer({ id: 'bus-line', type: 'line', source: 'bus-lines', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' }, paint: { 'line-color': lineColor, 'line-width': 4, 'line-opacity': 0.9 } });
      map.addLayer({ id: 'line-casing', type: 'line', source: 'lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4.5, 14, 8, 17, 13] } });
      map.addLayer({ id: 'line-glow', type: 'line', source: 'lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': lineColor, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 8, 14, 14, 17, 22], 'line-blur': 8, 'line-opacity': dark ? 0.35 : 0.15 } });
      map.addLayer({ id: 'line', type: 'line', source: 'lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': lineColor, 'line-width': width as never } });
      map.addSource('bikes', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'bikes', type: 'circle', source: 'bikes', layout: { visibility: 'none' }, paint: { 'circle-color': BIKE_COLOR, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 15, 7], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'bikes-label', type: 'symbol', source: 'bikes', minzoom: 15, layout: { visibility: 'none', 'text-field': ['concat', ['to-string', ['get', 'bikes']], ' · ', ['to-string', ['get', 'docks']], 'd'], 'text-size': 11, 'text-offset': [0, 1.3], 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': dark ? '#b3d7ff' : '#0b4f9c', 'text-halo-color': c.halo, 'text-halo-width': 1.5 } });
      map.addSource('bus-stops', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'bus-stops', type: 'circle', source: 'bus-stops', minzoom: 15.5, paint: { 'circle-color': c.stationFill, 'circle-radius': 4, 'circle-stroke-color': '#FFC72C', 'circle-stroke-width': 2 } });
      map.addSource('stations', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'station-ring', type: 'circle', source: 'stations', paint: { 'circle-color': c.stationFill, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 7, 17, 11], 'circle-stroke-color': ['concat', '#', ['get', 'color']], 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 14, 2.5] } });
      map.addLayer({ id: 'station-ring2', type: 'circle', source: 'stations', filter: ['has', 'color2'], minzoom: 12.5, paint: { 'circle-color': c.stationFill, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12.5, 3, 14, 4.2, 17, 7], 'circle-stroke-color': ['concat', '#', ['get', 'color2']], 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'station-dot', type: 'circle', source: 'stations', minzoom: 12, paint: { 'circle-color': '#ffffff', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 17, 3] } });
      map.addLayer({ id: 'station-label', type: 'symbol', source: 'stations', minzoom: 13.5, layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-anchor': 'left', 'text-offset': [1, 0], 'text-font': ['Noto Sans Bold'], 'text-optional': true }, paint: { 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 1.6 } });
      // Invisible, finger-sized targets over the small station and stop circles.
      map.addLayer({ id: 'station-hit', type: 'circle', source: 'stations', paint: { 'circle-radius': 22, 'circle-color': '#000000', 'circle-opacity': 0 } });
      map.addLayer({ id: 'bus-stop-hit', type: 'circle', source: 'bus-stops', minzoom: 15.5, paint: { 'circle-radius': 16, 'circle-color': '#000000', 'circle-opacity': 0 } });
      map.addSource('vehicles', { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: 'vehicles',
        type: 'symbol',
        source: 'vehicles',
        layout: {
          'icon-image': vehicleIconExpression,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 15, 0.95],
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'text-field': ['step', ['zoom'], '', 14, ['case', ['get', 'stale'], ['concat', ['get', 'label'], ' · ', ['get', 'ageLabel']], ['get', 'label']]],
          'text-size': 11,
          'text-offset': [0, 1.6],
          'text-font': ['Noto Sans Bold'],
          'text-optional': true,
        },
        paint: { 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 1.6, 'icon-opacity': ['case', ['get', 'stale'], 0.75, 1] },
      });
      map.addSource('vehicle-pick', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'vehicle-pick', type: 'circle', source: 'vehicle-pick', paint: { 'circle-radius': 22, 'circle-color': 'transparent', 'circle-stroke-color': '#51df8e', 'circle-stroke-width': 3 } }, 'vehicles');

      // One tap opens one thing. Per-layer handlers all fired at once, and the
      // last one (often a hidden layer's) won. The top-most target wins: a
      // vehicle's icon, then a station or stop, then a Bluebikes dock.
      const targets: [string, 'vehicle' | 'stop' | 'bike'][] = [
        ['vehicles', 'vehicle'],
        ['station-hit', 'stop'],
        ['bus-stop-hit', 'stop'],
        ['bikes', 'bike'],
      ];
      map.on('click', (e: MapMouseEvent) => {
        for (const [layer, kind] of targets) {
          if (map.getLayoutProperty(layer, 'visibility') === 'none') continue;
          const id = map.queryRenderedFeatures(e.point, { layers: [layer] })[0]?.properties?.id;
          if (id != null) return setSheet({ kind, id: String(id) });
        }
      });
      for (const [layer] of targets) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
      }
      setReady(true);
      report();
    });
    map.on('moveend', report);
    return () => {
      map.remove();
      mapRef.current = null;
    };
    };
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [dark, reducedMotion]);

  // ── Static layers ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !lines) return;
    animator.current.addShapes(lines.features);
    const on = new Set<Mode>(modesFor({ ...layers, modes: { ...layers.modes, bus: false } }, 20));
    (map.getSource('lines') as GeoJSONSource).setData({ ...lines, features: layers.lines ? lines.features.filter((f) => on.has(f.properties.mode)) : [] });
  }, [ready, lines, layers]);

  useEffect(() => {
    if (busShapes.features.length) animator.current.addShapes(busShapes.features);
  }, [busShapes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !stations) return;
    const features = layers.stops
      ? stations.map((s) => {
          const colors = [...new Set(s.routeIds.map((id) => (lines?.features.find((f) => f.properties.routeId === id)?.properties.color) ?? null).filter(Boolean))];
          return {
            type: 'Feature' as const,
            properties: { id: s.id, name: s.name, color: s.color, ...(colors[1] ? { color2: colors[1] } : {}) },
            geometry: { type: 'Point' as const, coordinates: [s.longitude, s.latitude] },
          };
        })
      : [];
    (map.getSource('stations') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }, [ready, stations, lines, layers.stops]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('bus-stops') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: layers.stops && layers.modes.bus ? busStops.map((s: StopSummary) => ({ type: 'Feature' as const, properties: { id: s.id, name: s.name }, geometry: { type: 'Point' as const, coordinates: [s.longitude, s.latitude] } })) : [],
    });
  }, [ready, busStops, layers.stops, layers.modes.bus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const vis = layers.bikes ? 'visible' : 'none';
    map.setLayoutProperty('bikes', 'visibility', vis);
    map.setLayoutProperty('bikes-label', 'visibility', vis);
    (map.getSource('bikes') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (bikes?.stations ?? []).map((b) => ({ type: 'Feature' as const, properties: { id: b.id, bikes: b.bikes, docks: b.docks }, geometry: { type: 'Point' as const, coordinates: [b.longitude, b.latitude] } })),
    });
  }, [ready, bikes, layers.bikes]);

  // ── Vehicles: feed reports in, draw frames while anything moves ───────────
  useEffect(() => {
    animator.current.update(feed.changed, new Set(feed.vehicles.keys()), serverNow());
    // feed.version changes with every update; that's the trigger.
  }, [feed.version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const source = map.getSource('vehicles') as GeoJSONSource;
    let raf = 0;
    let last = 0;
    let timer = 0;
    const draw = (t: number) => {
      if (t - last >= FRAME_MS) {
        last = t;
        const { features, moving } = animator.current.frame(serverNow());
        for (const f of features) (f.properties as Record<string, unknown>).ageLabel = formatAge(f.properties.ageSeconds).replace('updated ', '');
        source.setData({ type: 'FeatureCollection', features: layers.vehicles ? features : [] });
        const sel = sheet?.kind === 'vehicle' ? features.find((f) => f.properties.id === sheet.id) : undefined;
        (map.getSource('vehicle-pick') as GeoJSONSource).setData({ type: 'FeatureCollection', features: sel ? [sel] : [] });
        // Nothing gliding: redraw once a second (for age labels) instead of every frame.
        if (!moving || reducedMotion) {
          timer = window.setTimeout(() => (raf = requestAnimationFrame(draw)), 1000);
          return;
        }
      }
      raf = requestAnimationFrame(draw);
    };
    if (visible) raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [ready, feed.version, layers.vehicles, sheet, visible, reducedMotion]);

  // Bring a selected vehicle (or stop) into view above the sheet.
  const selectedId = sheet?.kind === 'vehicle' || sheet?.kind === 'stop' ? `${sheet.kind}:${sheet.id}` : null;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !selectedId) return;
    const [kind, id] = selectedId.split(/:(.+)/) as [string, string];
    const pos =
      kind === 'vehicle'
        ? animator.current.drawnPosition(id)
        : (() => {
            const s = stations?.find((x) => x.id === id);
            return s ? { lon: s.longitude, lat: s.latitude } : null;
          })();
    if (!pos) return;
    const h = map.getContainer().clientHeight;
    map.easeTo({ center: [pos.lon, pos.lat], zoom: kind === 'stop' ? Math.max(map.getZoom(), 15) : map.getZoom(), offset: [0, -h * 0.28], duration: reducedMotion ? 0 : 500 });
  }, [ready, selectedId, stations]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selecting a bus shows its route line.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const v = sheet?.kind === 'vehicle' ? feed.vehicles.get(sheet.id) : undefined;
    const busFeatures = v && v.mode === 'bus' ? busShapes.features.filter((f) => f.properties.routeId === v.routeId) : [];
    (map.getSource('bus-lines') as GeoJSONSource).setData({ type: 'FeatureCollection', features: busFeatures });
    map.setLayoutProperty('bus-line', 'visibility', busFeatures.length ? 'visible' : 'none');
    // Other lines step back while a vehicle is selected.
    map.setPaintProperty('line', 'line-opacity', v ? ['case', ['==', ['get', 'routeId'], v.routeId], 1, 0.3] : 1);
  }, [ready, sheet, feed.vehicles, busShapes]);

  // ── You, and a 4-minute walk around you ─────────────────────────────────
  const here = location.kind === 'ok' ? { lat: location.lat, lon: location.lon } : null;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!here) {
      youMarker.current?.remove();
      youMarker.current = null;
      (map.getSource('walk') as GeoJSONSource).setData(EMPTY);
      return;
    }
    if (!youMarker.current) {
      const el = document.createElement('div');
      el.className = 'relative flex size-8 items-center justify-center';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = '<span class="you-halo absolute inset-0 rounded-full" style="background:#51df8e55"></span><span class="relative size-4 rounded-full border-2 border-white" style="background:#12b76a;box-shadow:0 0 12px #51df8e"></span>';
      youMarker.current = new Marker({ element: el }).setLngLat([here.lon, here.lat]).addTo(map);
    } else youMarker.current.setLngLat([here.lon, here.lat]);
    // Straight-line reach of a 4-minute walk at your pace, allowing for street detours.
    const radius = (4 * 60 * WALK_SPEED[pace]) / DETOUR_FACTOR;
    (map.getSource('walk') as GeoJSONSource).setData(circlePolygon(here.lon, here.lat, radius));
  }, [ready, here?.lat, here?.lon, pace]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fly to you once, the first time we know where you are.
  const flown = useRef(false);
  useEffect(() => {
    if (here && mapRef.current && !flown.current && !sheet) {
      flown.current = true;
      mapRef.current.easeTo({ center: [here.lon, here.lat], zoom: 15, duration: reducedMotion ? 0 : 800 });
    }
  }, [here, sheet, reducedMotion]);

  const closeSheet = useCallback(() => closeSheetStep(), []);

  // ── Nearest station, docked at the bottom ────────────────────────────────
  const [nearby, setNearby] = useState<NearbyResponse | null>(null);
  useEffect(() => {
    if (!here) return;
    const ac = new AbortController();
    fetchNearby(here.lat, here.lon, pace, ac.signal)
      .then(setNearby)
      .catch(() => {});
    return () => ac.abort();
  }, [here?.lat, here?.lon, pace]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Status ────────────────────────────────────────────────────────────
  const vh = feed.status?.vehicles;
  const vAge = vh?.lastUpdateAt != null ? (now - vh.lastUpdateAt) / 1000 : null;
  const statusTone = feed.connection === 'lost' || vh?.state === 'down' ? 'down' : vh?.state === 'stale' || (vAge != null && vAge > staleAfterSeconds('heavy_rail')) ? 'stale' : vh ? 'live' : 'connecting';
  const statusText =
    statusTone === 'live'
      ? `Live · ${vAge != null ? formatAge(vAge) : 'updating'}`
      : statusTone === 'stale'
        ? vAge != null
          ? formatAge(vAge).replace(/^u/, 'U')
          : 'Updates delayed'
        : statusTone === 'down'
          ? 'Live positions unavailable'
          : 'Connecting…';

  const selectedVehicle: MapVehicle | undefined = sheet?.kind === 'vehicle' ? (feed.vehicles.get(sheet.id) ?? animator.current.vehicle(sheet.id)) : undefined;
  const selectedBike = sheet?.kind === 'bike' ? bikes?.stations.find((b) => b.id === sheet.id) : undefined;
  const inViewVehicles = view ? [...feed.vehicles.values()].filter((v) => v.longitude >= view.bbox[0] && v.longitude <= view.bbox[2] && v.latitude >= view.bbox[1] && v.latitude <= view.bbox[3]) : [];
  const inViewStations = view && stations ? stations.filter((s) => s.longitude >= view.bbox[0] && s.longitude <= view.bbox[2] && s.latitude >= view.bbox[1] && s.latitude <= view.bbox[3]) : [];
  const layersChanged = !layers.vehicles || !layers.stops || !layers.lines || layers.bikes || !layers.crowding;

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader title="Map" overlay />
      <div className="relative min-h-0 flex-1" style={{ marginBottom: 'calc(4.25rem + env(safe-area-inset-bottom))' }}>
        {/* MapLibre's stylesheet makes its container position: relative, so the positioning lives on a wrapper. */}
        <div className="absolute inset-0">
          <div ref={container} className="h-full w-full" role="region" aria-label="Map of transit around you. The In view list has the same information as text." />
        </div>
        {!ready && !mapError ? (
          <div className="bg-surface-2 text-muted absolute inset-0 z-10 flex items-center justify-center text-sm font-semibold" role="status">
            Loading map…
          </div>
        ) : null}
        {mapError ? (
          <p className="bg-surface-2 absolute inset-x-6 top-1/2 z-10 rounded-2xl p-4 text-center text-sm">
            This device can't draw the map. Use the list button on the right to see the vehicles and stations around downtown.
          </p>
        ) : null}

        {/* Top: search, live status, mode chips */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 space-y-2 p-3">
          <MapSearch
            onPick={(s) => {
              mapRef.current?.easeTo({ center: [s.longitude, s.latitude], zoom: 15.5, duration: reducedMotion ? 0 : 600 });
              setSheet({ kind: 'stop', id: s.id });
            }}
          />
          <div className="flex items-center gap-2">
            <p
              role="status"
              className={`pointer-events-auto inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold tracking-wide uppercase shadow-float ${
                statusTone === 'live' ? 'bg-surface-2 text-text' : statusTone === 'stale' ? 'bg-warn-bg text-warn-fg' : statusTone === 'down' ? 'bg-down-bg text-down-fg' : 'bg-surface-2 text-muted'
              }`}
            >
              <span className={`size-2 rounded-full ${statusTone === 'live' ? 'live-dot bg-[#51df8e]' : 'bg-current'}`} aria-hidden />
              {statusText}
            </p>
          </div>
          <div role="group" aria-label="Show on the map" className="no-scrollbar pointer-events-auto -mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
            {MODE_CHIPS.map(({ key, label, Icon }) => (
              <FilterChip key={key} active={layers.modes[key]} onClick={() => setLayers({ ...layers, modes: { ...layers.modes, [key]: !layers.modes[key] } })}>
                <Icon className="size-4" />
                {label}
              </FilterChip>
            ))}
            <FilterChip active={layers.bikes} onClick={() => setLayers({ ...layers, bikes: !layers.bikes })}>
              <span style={{ color: layers.bikes ? undefined : BIKE_COLOR }}>
                <BikeIcon className="size-4" />
              </span>
              Bluebikes
            </FilterChip>
          </div>
          {layers.modes.bus && zoom < BUS_MIN_ZOOM ? <p className="bg-surface-2 text-muted pointer-events-auto inline-block rounded-full px-3 py-1 text-xs shadow-float">Zoom in to see buses</p> : null}
          {(statusTone === 'stale' || statusTone === 'down') && !bannerClosed ? (
            <div role="alert" className="bg-warn-bg text-warn-fg pointer-events-auto flex items-start gap-3 rounded-2xl p-3 shadow-float">
              <WarnIcon className="mt-0.5 shrink-0" />
              <p className="flex-1 text-sm">
                <strong className="block">Live data is interrupted</strong>
                Vehicles are shown where they were last seen, greyed out, with how long ago.
              </p>
              <button type="button" onClick={() => setBannerClosed(true)} aria-label="Dismiss" className="-m-2 flex size-11 items-center justify-center">
                <CloseIcon />
              </button>
            </div>
          ) : null}
        </div>

        {/* Right: map controls, out of the way while a sheet is open (as in Google Maps) */}
        <div className={`absolute top-44 right-3 z-20 flex-col gap-2 ${sheet ? 'hidden' : 'flex'}`}>
          <MapButton
            label="Show where I am"
            onClick={() => {
              if (!optIn) setOptIn(true);
              if (here) mapRef.current?.easeTo({ center: [here.lon, here.lat], zoom: Math.max(zoom, 15), duration: reducedMotion ? 0 : 600 });
            }}
          >
            <LocateIcon className="text-brand-text" />
          </MapButton>
          <MapButton
            label={pitched ? 'Flat view' : 'Tilted 3D view'}
            pressed={pitched}
            onClick={() => {
              mapRef.current?.easeTo({ pitch: pitched ? 0 : 50, duration: reducedMotion ? 0 : 500 });
              setPitched(!pitched);
            }}
          >
            <span className="text-sm font-extrabold">3D</span>
          </MapButton>
          <MapButton label="Map layers" onClick={() => setSheet({ kind: 'layers' })} dot={layersChanged}>
            <LayersIcon />
          </MapButton>
          <MapButton label="List what's in view" onClick={() => setSheet({ kind: 'list' })}>
            <ListIcon />
          </MapButton>
          <div className="bg-surface-2 shadow-float flex flex-col overflow-hidden rounded-full">
            <button type="button" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()} className="flex size-11 items-center justify-center text-xl font-bold">
              +
            </button>
            <span className="bg-line mx-2 h-px" aria-hidden />
            <button type="button" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()} className="flex size-11 items-center justify-center text-xl font-bold">
              −
            </button>
          </div>
        </div>

        {/* Bottom: nearest station, when nothing else is open */}
        {!sheet && nearby?.stops[0] ? (
          <NearestCard nearby={nearby} now={now} onOpen={(id) => setSheet({ kind: 'stop', id })} />
        ) : null}

        {sheet?.kind === 'vehicle' && selectedVehicle ? <VehicleSheet vehicle={selectedVehicle} onClose={closeSheet} /> : null}
        {sheet?.kind === 'stop' ? (
          <StopSheet stopId={sheet.id} onClose={closeSheet} here={here} pace={pace} pinned={pins.includes(sheet.id)} onTogglePin={togglePin} />
        ) : null}
        {sheet?.kind === 'bike' && selectedBike ? <BikeSheet station={selectedBike} updatedAt={bikes?.updatedAt ?? null} onClose={closeSheet} /> : null}
        {sheet?.kind === 'layers' ? <LayersSheet layers={layers} onChange={setLayers} onClose={closeSheet} /> : null}
        {sheet?.kind === 'list' ? (
          <InViewSheet
            vehicles={inViewVehicles}
            stations={inViewStations}
            center={view?.center ?? { lat: DOWNTOWN[1], lon: DOWNTOWN[0] }}
            onVehicle={(id) => setSheet({ kind: 'vehicle', id })}
            onStop={(id) => setSheet({ kind: 'stop', id })}
            onClose={closeSheet}
          />
        ) : null}
      </div>
    </div>
  );
}

function MapButton(props: { label: string; onClick: () => void; children: React.ReactNode; pressed?: boolean; dot?: boolean }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.pressed}
      onClick={props.onClick}
      className={`shadow-float relative flex size-12 items-center justify-center rounded-full ${props.pressed ? 'bg-brand text-on-brand' : 'bg-surface-2 text-text'}`}
    >
      {props.children}
      {props.dot ? <span className="bg-brand-text absolute top-2 right-2 size-2 rounded-full" aria-hidden /> : null}
    </button>
  );
}

function MapSearch({ onPick }: { onPick: (s: StopSummary) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<StopSummary[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      searchStops(q, ac.signal)
        .then((r) => setResults(r.stops.slice(0, 6)))
        .catch(() => {});
    }, 200);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [q]);
  return (
    <div className="pointer-events-auto relative">
      <label className="bg-surface-2 shadow-float flex h-12 items-center gap-2 rounded-full px-4">
        <SearchIcon className="text-brand-text shrink-0" />
        <span className="visually-hidden">Search stops and stations</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search stops and stations"
          autoComplete="off"
          className="placeholder:text-muted min-w-0 flex-1 bg-transparent text-base outline-none"
        />
        {q ? (
          <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="-mr-2 flex size-10 items-center justify-center">
            <CloseIcon className="size-5" />
          </button>
        ) : null}
      </label>
      {results.length > 0 ? (
        <ul className="bg-surface-2 shadow-float divide-line absolute inset-x-0 top-14 z-30 divide-y overflow-hidden rounded-2xl">
          {results.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="w-full px-4 py-3 text-left"
                onClick={() => {
                  onPick(s);
                  setQ('');
                }}
              >
                <span className="font-bold">{s.name}</span>
                <span className="text-muted block text-xs">{s.isStation ? 'Station' : 'Stop'}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function NearestCard({ nearby, now, onOpen }: { nearby: NearbyResponse; now: number; onOpen: (id: string) => void }) {
  const stop = nearby.stops[0]!;
  const board = nearby.boards[0];
  const group = board?.groups.find((g) => g.rows.length > 0);
  const row = group?.rows.find((r) => !r.canceled);
  const route = group ? nearby.routes.find((r) => r.id === group.routeId) : undefined;
  let time = '';
  if (row && group) {
    const d =
      row.source === 'scheduled' || row.source === 'vehicle'
        ? displayScheduled(now, row.scheduledTime ?? 0)
        : displayPrediction({ mode: group.mode, now, arrivalTime: row.arrivalTime, departureTime: row.departureTime, status: row.status, vehicleStoppedHere: row.vehicleStoppedHere });
    time = d.kind === 'hidden' ? '' : d.text;
  }
  const leaves = row ? rowLeavesAt(row) : null;
  const level = row && leaves ? canMakeIt({ now, leavesAt: leaves, walk: stop.walk, source: row.source }).level : null;
  return (
    <button
      type="button"
      onClick={() => onOpen(stop.id)}
      className="bg-surface-2 shadow-float absolute inset-x-3 bottom-3 z-20 rounded-2xl p-3 text-left"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-base font-extrabold">{stop.name}</span>
          <span className="text-muted block text-sm">about {Math.max(1, Math.round(stop.walk.seconds / 60))} min walk · nearest stop</span>
        </span>
        <span className="text-brand-text shrink-0 text-sm font-bold">Departures</span>
      </span>
      {row && route ? (
        <span className="border-line mt-2 flex items-center justify-between gap-2 border-t pt-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="size-3 shrink-0 rounded-full" style={{ background: `#${route.color}` }} aria-hidden />
            <span className="truncate font-bold">
              {route.mode === 'bus' ? `Route ${route.shortName}` : route.longName} <span className="text-muted font-normal">to {row.headsign}</span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="tabular text-lg font-extrabold">{time}</span>
            {row.source !== 'live' ? <span className="text-muted text-xs">{row.source === 'estimate' ? 'Estimate' : 'Scheduled'}</span> : null}
            {level ? (
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${level === 'comfortable' ? 'bg-ok-bg text-ok-fg' : level === 'hurry' ? 'bg-hurry-bg text-hurry-fg' : 'bg-miss-bg text-miss-fg'}`}>
                {level === 'comfortable' ? '✓ You have time' : level === 'hurry' ? '⚡ Hurry' : "✕ You'll miss it"}
              </span>
            ) : null}
          </span>
        </span>
      ) : null}
    </button>
  );
}
