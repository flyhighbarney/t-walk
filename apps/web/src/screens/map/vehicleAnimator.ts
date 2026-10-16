// Turns vehicle reports into marker positions, frame by frame, using the
// honest-motion rules in packages/core/src/motion.ts: glide to each new report
// along the route line, a short capped run while moving, frozen and greyed
// when stale. Only this file knows about animation frames.

import {
  addReport,
  pointAlong,
  positionAt,
  prepareShape,
  snapToShape,
  staleAfterSeconds,
  type DrawnPosition,
  type MapVehicle,
  type PreparedShape,
  type ShapeFeature,
  type Track,
} from '@twalk/core';

/** Further than this from its line, a vehicle is off it (detour, shuttle, bad match). */
const MAX_SNAP_OFFSET_M = 60;

interface Entry {
  v: MapVehicle;
  track: Track;
  shape: PreparedShape | null;
  drawn: DrawnPosition | null;
}

export interface VehiclePoint {
  type: 'Feature';
  id: number;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    id: string;
    routeId: string;
    color: string;
    label: string;
    bearing: number;
    hasBearing: boolean;
    stale: boolean;
    ageSeconds: number;
    mode: string;
    occupancy: string | null;
  };
}

export class VehicleAnimator {
  private readonly entries = new Map<string, Entry>();
  private readonly shapes = new Map<string, PreparedShape>();
  /** routeId|directionId → most-used shape, for trips not in the schedule. */
  private readonly mainShape = new Map<string, string>();
  private ids = new Map<string, number>();
  private nextId = 1;
  reducedMotion = false;

  addShapes(features: ShapeFeature[]): void {
    for (const f of features) {
      if (this.shapes.has(f.properties.shapeId)) continue;
      this.shapes.set(f.properties.shapeId, prepareShape(f.geometry.coordinates));
      if (f.properties.main) this.mainShape.set(`${f.properties.routeId}|${f.properties.directionId}`, f.properties.shapeId);
    }
  }

  private shapeFor(v: MapVehicle): PreparedShape | null {
    const id = (v.shapeId && this.shapes.has(v.shapeId) ? v.shapeId : null) ?? this.mainShape.get(`${v.routeId}|${v.directionId ?? 0}`);
    return id ? (this.shapes.get(id) ?? null) : null;
  }

  /** Feed in vehicles that changed (or all of them on a snapshot), and drop the ones gone. */
  update(changed: MapVehicle[], present: ReadonlySet<string>, now: number): void {
    for (const id of this.entries.keys()) if (!present.has(id)) this.entries.delete(id);
    for (const v of changed) {
      const prev = this.entries.get(v.id);
      let shape = this.shapeFor(v);
      let distance: number | null = null;
      if (shape) {
        const snap = snapToShape(shape, v.longitude, v.latitude);
        if (snap && snap.offset <= MAX_SNAP_OFFSET_M) distance = snap.distance;
        else shape = null;
      }
      let cap: number | null = null;
      if (shape && v.stopLat != null && v.stopLon != null && v.currentStatus !== 'STOPPED_AT') {
        const s = snapToShape(shape, v.stopLon, v.stopLat);
        if (s && s.offset <= MAX_SNAP_OFFSET_M) cap = s.distance;
      }
      // A new trip on the same vehicle starts a new track.
      const sameTrip = prev && prev.v.tripId === v.tripId && prev.shape === shape;
      const track = addReport(
        sameTrip ? prev.track : null,
        { t: v.updatedAt, lon: v.longitude, lat: v.latitude, distance, moving: v.currentStatus !== 'STOPPED_AT', capDistance: cap },
        now,
        sameTrip && prev.drawn ? { lon: prev.drawn.lon, lat: prev.drawn.lat, distance: prev.drawn.distance } : null,
      );
      this.entries.set(v.id, { v, track, shape, drawn: prev?.drawn ?? null });
    }
  }

  vehicle(id: string): MapVehicle | undefined {
    return this.entries.get(id)?.v;
  }

  /** Positions at `now`, and whether anything is still in motion (to keep the frame loop going). */
  frame(now: number): { features: VehiclePoint[]; moving: boolean } {
    const features: VehiclePoint[] = [];
    let moving = false;
    for (const e of this.entries.values()) {
      const shape = e.shape;
      const along = shape ? (d: number) => pointAlong(shape, d) : null;
      const p = positionAt(e.track, now, {
        staleAfterMs: staleAfterSeconds(e.v.mode) * 1000,
        reducedMotion: this.reducedMotion,
        along,
      });
      e.drawn = p;
      if (p.state === 'moving') moving = true;
      let bearing = e.v.bearing ?? 0;
      let hasBearing = e.v.bearing != null;
      if (shape && p.distance != null) {
        bearing = pointAlong(shape, p.distance).bearing;
        hasBearing = true;
      }
      let num = this.ids.get(e.v.id);
      if (num == null) this.ids.set(e.v.id, (num = this.nextId++));
      features.push({
        type: 'Feature',
        id: num,
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: {
          id: e.v.id,
          routeId: e.v.routeId,
          color: e.v.color,
          label: e.v.routeLabel,
          bearing,
          hasBearing,
          stale: p.state === 'stale',
          ageSeconds: Math.round(p.ageSeconds),
          mode: e.v.mode,
          occupancy: e.v.occupancy,
        },
      });
    }
    return { features, moving };
  }

  /** Where a vehicle is drawn right now (to center the map on it). */
  drawnPosition(id: string): { lon: number; lat: number } | null {
    const d = this.entries.get(id)?.drawn;
    return d ? { lon: d.lon, lat: d.lat } : null;
  }
}
