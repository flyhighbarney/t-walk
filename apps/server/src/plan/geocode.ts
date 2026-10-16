// Place search for the trip planner: our own stops first, then addresses and
// places from Photon (photon.komoot.io), the public OpenStreetMap geocoder that
// allows search-as-you-type on fair use (no SLA; checked 2026-10-16). Every
// query goes through here: cached, throttled, and kept to the MBTA area.

import type { GtfsDb } from '../gtfs/db.ts';

export interface PlaceResult {
  id: string;
  name: string;
  /** Street, town: what tells two places with one name apart. */
  detail: string;
  lat: number;
  lon: number;
  kind: 'stop' | 'station' | 'place' | 'address';
}

/** The MBTA area, Commuter Rail included (Worcester, Wickford, Newburyport). */
const AREA = { west: -71.95, south: 41.55, east: -70.55, north: 42.9 };
const CACHE_MS = 24 * 3600_000;
const MIN_GAP_MS = 250;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class Geocoder {
  private cache = new Map<string, { at: number; results: PlaceResult[] }>();
  private last = 0;
  private readonly userAgent: string;
  private readonly getDb: () => GtfsDb;
  private readonly fetch: Fetch;
  private readonly baseUrl: string;

  constructor(opts: { userAgent: string; getDb: () => GtfsDb; fetch?: Fetch; baseUrl?: string }) {
    this.userAgent = opts.userAgent;
    this.getDb = opts.getDb;
    this.fetch = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl ?? 'https://photon.komoot.io/api/';
  }

  async search(q: string, near: { lat: number; lon: number } | null): Promise<{ results: PlaceResult[]; placesAvailable: boolean }> {
    const query = q.trim().replace(/\s+/g, ' ').slice(0, 120);
    if (query.length < 2) return { results: [], placesAvailable: true };
    const stops = this.getDb()
      .search(query, 4)
      .map(
        (s): PlaceResult => ({
          id: `stop:${s.id}`,
          name: s.name,
          detail: s.isStation ? 'Station' : 'Stop',
          lat: s.latitude,
          lon: s.longitude,
          kind: s.isStation ? 'station' : 'stop',
        }),
      );
    let places: PlaceResult[] = [];
    let placesAvailable = true;
    try {
      places = await this.photon(query, near);
    } catch {
      placesAvailable = false;
    }
    return { results: [...stops, ...places].slice(0, 10), placesAvailable };
  }

  private async photon(query: string, near: { lat: number; lon: number } | null): Promise<PlaceResult[]> {
    // Near-identical positions share a cache entry.
    const key = `${query.toLowerCase()}|${near ? `${near.lat.toFixed(2)},${near.lon.toFixed(2)}` : ''}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.results;
    // Be gentle with a free service: space requests out.
    const wait = this.last + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
    const bias = near ?? { lat: 42.3555, lon: -71.0603 };
    const url =
      `${this.baseUrl}?q=${encodeURIComponent(query)}&limit=8&lang=en` +
      `&lat=${bias.lat.toFixed(4)}&lon=${bias.lon.toFixed(4)}` +
      `&bbox=${AREA.west},${AREA.south},${AREA.east},${AREA.north}`;
    const res = await this.fetch(url, { headers: { 'User-Agent': this.userAgent }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
    const body = (await res.json()) as {
      features: {
        geometry: { coordinates: [number, number] };
        properties: { osm_id?: number; osm_type?: string; osm_key?: string; osm_value?: string; name?: string; housenumber?: string; street?: string; city?: string; district?: string; state?: string; type?: string };
      }[];
    };
    const results = body.features
      .map((f): PlaceResult | null => {
        const p = f.properties;
        const [lon, lat] = f.geometry.coordinates;
        if (lon < AREA.west || lon > AREA.east || lat < AREA.south || lat > AREA.north) return null;
        // Transit stops come from the MBTA's own data (listed first); OSM's copies would only duplicate them.
        if (p.osm_key === 'public_transport' || p.osm_key === 'railway' || p.osm_value === 'bus_stop') return null;
        const street = [p.housenumber, p.street].filter(Boolean).join(' ');
        const name = p.name ?? street;
        if (!name) return null;
        const detail = [p.name ? street : null, p.district ?? p.city].filter(Boolean).join(', ');
        return { id: `osm:${p.osm_type ?? ''}${p.osm_id ?? `${lat},${lon}`}`, name, detail, lat, lon, kind: p.name ? 'place' : 'address' };
      })
      .filter((r): r is PlaceResult => r != null)
      // OSM often has a place twice (as a point and as an outline): keep one per name within ~150 m.
      .filter((r, i, all) => all.findIndex((x) => x.name === r.name && Math.abs(x.lat - r.lat) < 0.0015 && Math.abs(x.lon - r.lon) < 0.002) === i);
    if (this.cache.size > 2000) this.cache.clear();
    this.cache.set(key, { at: Date.now(), results });
    return results;
  }
}
