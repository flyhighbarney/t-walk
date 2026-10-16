import { describe, expect, it } from 'vitest';
import { pointAlong, prepareShape, simplify, snapToShape, type LngLat } from './geo.ts';
import { addReport, EXTRAPOLATE_MAX_MS, positionAt, TRANSITION_MS, type VehicleReport } from './motion.ts';

// A straight 1 km line due north from Park Street, and a dogleg.
const LAT0 = 42.3564;
const LON0 = -71.0624;
const north = (m: number): LngLat => [LON0, LAT0 + m / 110_574];
const LINE = prepareShape([north(0), north(500), north(1000)]);

describe('geometry', () => {
  it('measures and walks along a shape', () => {
    expect(LINE.length).toBeCloseTo(1000, 0);
    const p = pointAlong(LINE, 250);
    expect(p.lat).toBeCloseTo(north(250)[1], 6);
    expect(p.bearing).toBeCloseTo(0, 0);
  });

  it('snaps a point beside the line onto it', () => {
    const kx = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
    const s = snapToShape(LINE, LON0 + 20 / kx, north(300)[1])!;
    expect(s.distance).toBeCloseTo(300, 0);
    expect(s.offset).toBeCloseTo(20, 0);
  });

  it('simplifies a straight run to its ends but keeps a real corner', () => {
    const straight = Array.from({ length: 50 }, (_, i) => north(i * 20));
    expect(simplify(straight, 5)).toHaveLength(2);
    const kx = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
    const dogleg: LngLat[] = [north(0), north(500), [LON0 + 500 / kx, north(500)[1]]];
    expect(simplify(dogleg, 5)).toHaveLength(3);
  });
});

const along = (d: number) => pointAlong(LINE, d);
const rep = (t: number, distance: number | null, over: Partial<VehicleReport> = {}): VehicleReport => {
  const p = distance == null ? { lon: LON0 + 0.01, lat: LAT0 } : pointAlong(LINE, distance);
  return { t, lon: p.lon, lat: p.lat, distance, moving: true, capDistance: null, ...over };
};
const opts = { staleAfterMs: 60_000, reducedMotion: false, along };

describe('vehicle motion', () => {
  const T = 1_000_000;

  it('glides from where it was drawn to the new report, then continues at the measured speed', () => {
    let tr = addReport(null, rep(T, 100), T, null);
    tr = addReport(tr, rep(T + 10_000, 200), T + 10_000, { ...along(100), distance: 100 }); // 10 m/s
    expect(tr.speed).toBeCloseTo(10);
    // Halfway through the glide it's between the two (eased).
    const mid = positionAt(tr, T + 10_000 + TRANSITION_MS / 2, opts);
    expect(mid.distance!).toBeGreaterThan(100);
    expect(mid.distance!).toBeLessThan(210);
    // After the glide: report + speed × age.
    const later = positionAt(tr, T + 13_000, opts);
    expect(later.distance).toBeCloseTo(230, 0);
    expect(later.state).toBe('moving');
  });

  it('never runs ahead more than the extrapolation window', () => {
    let tr = addReport(null, rep(T, 100), T, null);
    tr = addReport(tr, rep(T + 10_000, 200), T + 10_000, null);
    const p = positionAt(tr, T + 10_000 + EXTRAPOLATE_MAX_MS + 20_000, opts);
    expect(p.distance).toBeCloseTo(200 + 10 * (EXTRAPOLATE_MAX_MS / 1000), 0);
    expect(p.state).toBe('holding');
  });

  it('never runs past the stop it is heading for', () => {
    let tr = addReport(null, rep(T, 100), T, null);
    tr = addReport(tr, rep(T + 10_000, 200, { capDistance: 230 }), T + 10_000, null);
    expect(positionAt(tr, T + 19_000, opts).distance).toBeCloseTo(230, 0);
  });

  it("doesn't move a vehicle stopped at a stop", () => {
    let tr = addReport(null, rep(T, 100), T, null);
    tr = addReport(tr, rep(T + 10_000, 200, { moving: false }), T + 10_000, null);
    const p = positionAt(tr, T + 15_000, opts);
    expect(p).toMatchObject({ distance: 200, state: 'holding' });
  });

  it('freezes a stale vehicle exactly where it was last reported', () => {
    let tr = addReport(null, rep(T, 100), T, null);
    tr = addReport(tr, rep(T + 10_000, 200), T + 10_000, null);
    const p = positionAt(tr, T + 10_000 + 61_000, opts);
    expect(p).toMatchObject({ distance: 200, state: 'stale' });
    expect(p.ageSeconds).toBeCloseTo(61);
  });

  it('ignores small backwards jitter but accepts a real jump', () => {
    let tr = addReport(null, rep(T, 300), T, null);
    tr = addReport(tr, rep(T + 5_000, 290), T + 5_000, null);
    expect(tr.reports.at(-1)!.distance).toBe(300);
    tr = addReport(tr, rep(T + 10_000, 50), T + 10_000, null);
    expect(tr.reports.at(-1)!.distance).toBe(50);
    expect(tr.speed).toBeNull();
  });

  it('rejects impossible speeds', () => {
    let tr = addReport(null, rep(T, 0), T, null);
    tr = addReport(tr, rep(T + 2_000, 900), T + 2_000, null); // 450 m/s
    expect(tr.speed).toBeNull();
    expect(positionAt(tr, T + 5_000, opts).distance).toBe(900);
  });

  it('ignores a repeated report', () => {
    const tr = addReport(null, rep(T, 100), T, null);
    expect(addReport(tr, rep(T, 150), T + 3_000, null)).toBe(tr);
  });

  it('shows reported points only with reduced motion', () => {
    let tr = addReport(null, rep(T, 100), T, null);
    tr = addReport(tr, rep(T + 10_000, 200), T + 10_000, { ...along(100), distance: 100 });
    const p = positionAt(tr, T + 10_100, { ...opts, reducedMotion: true });
    expect(p.lat).toBeCloseTo(along(200).lat, 7);
    expect(p.state).toBe('holding');
  });

  it("doesn't guess for a vehicle off its line", () => {
    let tr = addReport(null, rep(T, null), T, null);
    tr = addReport(tr, rep(T + 10_000, null, { lat: LAT0 + 0.001 }), T + 10_000, { lon: LON0 + 0.01, lat: LAT0, distance: null });
    const p = positionAt(tr, T + 15_000, opts);
    expect(p).toMatchObject({ lat: LAT0 + 0.001, distance: null, state: 'holding' });
  });
});
