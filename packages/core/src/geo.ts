// Geometry on route shapes: simplifying them for the map, snapping a vehicle's
// reported position onto its line, and finding the point a given distance
// along it. Distances are metres, using a local flat projection (accurate to
// well under 1% across the MBTA area).

export type LngLat = [number, number];

const M_PER_DEG_LAT = 110_574;
const mPerDegLon = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Douglas–Peucker simplification, tolerance in metres. Endpoints are kept. */
export function simplify(coords: LngLat[], toleranceM: number): LngLat[] {
  if (coords.length < 3) return coords.slice();
  const kx = mPerDegLon(coords[0]![1]);
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = [coords[a]![0] * kx, coords[a]![1] * M_PER_DEG_LAT];
    const [bx, by] = [coords[b]![0] * kx, coords[b]![1] * M_PER_DEG_LAT];
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = coords[i]![0] * kx;
      const py = coords[i]![1] * M_PER_DEG_LAT;
      const d = segmentDistance(px, py, ax, ay, bx, by).dist;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > toleranceM && idx !== -1) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return coords.filter((_, i) => keep[i] === 1);
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): { dist: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), t };
}

export interface PreparedShape {
  coords: LngLat[];
  /** Distance from the start to each point, metres. */
  cum: number[];
  length: number;
  kx: number;
}

export function prepareShape(coords: LngLat[]): PreparedShape {
  const kx = mPerDegLon(coords[0]?.[1] ?? 42.35);
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = coords[i - 1]!;
    const [x2, y2] = coords[i]!;
    cum.push(cum[i - 1]! + Math.hypot((x2 - x1) * kx, (y2 - y1) * M_PER_DEG_LAT));
  }
  return { coords, cum, length: cum[cum.length - 1] ?? 0, kx };
}

export interface Snap {
  /** Metres from the start of the shape. */
  distance: number;
  /** How far the point is from the line, metres. */
  offset: number;
  lon: number;
  lat: number;
}

/** The nearest point on the shape. */
export function snapToShape(shape: PreparedShape, lon: number, lat: number): Snap | null {
  const { coords, cum, kx } = shape;
  if (coords.length < 2) return null;
  const px = lon * kx;
  const py = lat * M_PER_DEG_LAT;
  let best: Snap | null = null;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const { dist, t } = segmentDistance(px, py, a[0] * kx, a[1] * M_PER_DEG_LAT, b[0] * kx, b[1] * M_PER_DEG_LAT);
    if (!best || dist < best.offset) {
      best = {
        distance: cum[i - 1]! + t * (cum[i]! - cum[i - 1]!),
        offset: dist,
        lon: a[0] + t * (b[0] - a[0]),
        lat: a[1] + t * (b[1] - a[1]),
      };
    }
  }
  return best;
}

/** The point `distance` metres along the shape, and the direction of travel there (degrees from north). */
export function pointAlong(shape: PreparedShape, distance: number): { lon: number; lat: number; bearing: number } {
  const { coords, cum } = shape;
  const d = Math.max(0, Math.min(shape.length, distance));
  let lo = 1;
  let hi = coords.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! < d) lo = mid + 1;
    else hi = mid;
  }
  const a = coords[lo - 1]!;
  const b = coords[lo]!;
  const seg = cum[lo]! - cum[lo - 1]!;
  const t = seg === 0 ? 0 : (d - cum[lo - 1]!) / seg;
  const bearing = (Math.atan2((b[0] - a[0]) * shape.kx, (b[1] - a[1]) * M_PER_DEG_LAT) * 180) / Math.PI;
  return { lon: a[0] + t * (b[0] - a[0]), lat: a[1] + t * (b[1] - a[1]), bearing: (bearing + 360) % 360 };
}

/** A heading smoothed by blending unit vectors, so it survives round-tripping through north. */
export interface HeadingVector {
  x: number;
  y: number;
}

/** Blends a new heading (degrees from north) into a running one, handling the 359°→1° wrap a plain average gets wrong. */
export function smoothHeading(prev: HeadingVector | null, headingDeg: number, amount = 0.3): HeadingVector {
  const rad = (headingDeg * Math.PI) / 180;
  const point = { x: Math.cos(rad), y: Math.sin(rad) };
  return prev ? { x: prev.x + amount * (point.x - prev.x), y: prev.y + amount * (point.y - prev.y) } : point;
}

/** The smoothed heading itself, degrees from north. */
export function headingOf(v: HeadingVector): number {
  return ((Math.atan2(v.y, v.x) * 180) / Math.PI + 360) % 360;
}
