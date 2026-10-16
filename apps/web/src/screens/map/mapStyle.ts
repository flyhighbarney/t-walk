// The map's look: a quiet OpenFreeMap basemap (dark navy to match the design,
// or Positron when the phone is in light mode) under bold official line
// colours, ringed stations, vehicle markers and Bluebikes pills.

import type { ExpressionSpecification, Map as MlMap, StyleSpecification } from 'maplibre-gl';

export const BASEMAP = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
};

export const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/**
 * The basemap style, or a plain background if it can't be fetched (offline,
 * or OpenFreeMap down): the transit layers then still draw on their own.
 */
export async function loadBasemap(dark: boolean): Promise<StyleSpecification> {
  try {
    const res = await fetch(dark ? BASEMAP.dark : BASEMAP.light, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as StyleSpecification;
  } catch {
    const c = dark ? MAP_COLORS.dark : MAP_COLORS.light;
    return {
      version: 8,
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': c.land } }],
    };
  }
}

/** A greyscale basemap, so the MBTA's line colours (and you, in green) are what stands out. */
export const MAP_COLORS = {
  dark: { land: '#0a0a0a', water: '#1c1c1e', park: '#121212', road: '#262626', building: '#151515', casing: '#000000', stationFill: '#0a0a0a', label: '#fafafa', halo: '#000000' },
  light: { land: '#f4f4f5', water: '#dcdce0', park: '#e9e9eb', road: '#ffffff', building: '#e7e7ea', casing: '#ffffff', stationFill: '#ffffff', label: '#0a0a0a', halo: '#ffffff' },
};

export const BIKE_COLOR = '#2b7fff';
/** Stale vehicles: neutral grey, readable on both themes. */
export const STALE_COLOR = '#8a94a6';

/** Turn the basemap down so the transit lines are what you see. */
export function muteBasemap(map: MlMap, dark: boolean): void {
  const c = dark ? MAP_COLORS.dark : MAP_COLORS.light;
  for (const layer of map.getStyle().layers ?? []) {
    const id = layer.id;
    try {
      if (layer.type === 'background') map.setPaintProperty(id, 'background-color', c.land);
      else if (layer.type === 'fill' && /water/.test(id)) map.setPaintProperty(id, 'fill-color', c.water);
      else if (layer.type === 'fill' && /park|landuse_park|grass|wood/.test(id)) map.setPaintProperty(id, 'fill-color', c.park);
      else if (layer.type === 'fill' && /building/.test(id)) map.setPaintProperty(id, 'fill-color', c.building);
      // Streets stay as quiet lines; the basemap's own rail lines would compete with ours.
      else if (layer.type === 'line' && /rail|transit/.test(id)) map.setLayoutProperty(id, 'visibility', 'none');
      else if (layer.type === 'line' && /highway|road|tunnel|bridge|street|path/.test(id)) map.setPaintProperty(id, 'line-color', c.road);
      // Shops, restaurants and the like compete with the transit; leave place and street names.
      else if (layer.type === 'symbol' && /poi|transit|airport|aerialway|housenumber/.test(id)) map.setLayoutProperty(id, 'visibility', 'none');
      else if (layer.type === 'symbol') map.setPaintProperty(id, 'text-opacity', 0.75);
    } catch {
      // A layer without that property: leave it as the basemap has it.
    }
  }
}

/**
 * Replaces the flat building layer with extruded ones, for navigation's tilted view. OpenFreeMap's
 * tiles are unmodified OpenMapTiles, whose building layer carries `render_height`/`render_min_height`
 * (plus `hide_3d` for footprints — outlines of buildings already drawn elsewhere — that shouldn't be
 * extruded). Not called for Now/Map, which keep the flat 2D buildings `muteBasemap` already recolours.
 */
export function addBuildingExtrusion(map: MlMap, dark: boolean): void {
  const base = (map.getStyle().layers ?? []).find((l) => l.type === 'fill' && /building/.test(l.id) && 'source-layer' in l);
  if (!base || !('source-layer' in base) || !base['source-layer']) return;
  try {
    map.setLayoutProperty(base.id, 'visibility', 'none');
    const hideOutlines: ExpressionSpecification = ['!=', ['get', 'hide_3d'], true];
    const filter = (base.filter ? ['all', base.filter, hideOutlines] : hideOutlines) as ExpressionSpecification;
    map.addLayer(
      {
        id: 'buildings-3d',
        type: 'fill-extrusion',
        source: base.source,
        'source-layer': base['source-layer'],
        ...(base.minzoom != null ? { minzoom: base.minzoom } : {}),
        filter,
        paint: {
          'fill-extrusion-color': dark ? '#242428' : '#d8d8dd',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 5],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.9,
        },
      },
      base.id,
    );
  } catch {
    // Tiles without building height data (or an unexpected basemap): leave buildings flat.
  }
}

/** Route colour from a feature's `color` property ("DA291C"). */
export const lineColor: ExpressionSpecification = ['concat', '#', ['get', 'color']];

export function addVehicleImages(map: MlMap): void {
  // Markers are drawn on demand, one per colour and state: "veh|DA291C|a" (arrow) or "|d" (dot).
  map.setMissingStyleImageResolver((id) => {
    if (!id.startsWith('veh|')) return;
    const [, hex, kind] = id.split('|');
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d')!;
    const color = `#${hex}`;
    const cx = size / 2;
    // Pointer (drawn first, under the disc), pointing up; the layer rotates it.
    if (kind === 'a') {
      g.fillStyle = color;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(cx, 3);
      g.lineTo(cx + 15, 26);
      g.lineTo(cx - 15, 26);
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.beginPath();
    g.arc(cx, cx + 2, 17, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#ffffff';
    g.stroke();
    // A white centre dot reads at a glance on every line colour.
    g.beginPath();
    g.arc(cx, cx + 2, 5, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    map.addImage(id, g.getImageData(0, 0, size, size), { pixelRatio: 2 });
  });
}

/** Image id for a vehicle marker: its line's colour, or grey when stale. */
export const vehicleIconExpression: ExpressionSpecification = [
  'concat',
  'veh|',
  ['case', ['get', 'stale'], STALE_COLOR.slice(1), ['get', 'color']],
  ['case', ['get', 'hasBearing'], '|a', '|d'],
];
