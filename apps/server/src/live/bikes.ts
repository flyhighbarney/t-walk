// Bluebikes station locations and live bike/dock counts, from its public GBFS
// 2.3 feed (gbfs.lyft.com/gbfs/2.3/bos, checked 2026-10-16: 626 stations,
// ttl 60 s). Station details refresh hourly, counts every minute.

import type { BikeStation } from '@twalk/core';

const BASE = 'https://gbfs.lyft.com/gbfs/2.3/bos/en';

interface InfoRow {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  capacity?: number;
}
interface StatusRow {
  station_id: string;
  num_bikes_available: number;
  num_ebikes_available?: number;
  num_docks_available: number;
  is_installed: number;
  is_renting: number;
  is_returning: number;
  last_reported: number;
}

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class BikesFeed {
  private info = new Map<string, InfoRow>();
  private status = new Map<string, StatusRow>();
  updatedAt: number | null = null;
  private timers: NodeJS.Timeout[] = [];
  private readonly fetch: Fetch;
  private readonly log: (msg: string) => void;
  private readonly userAgent: string;

  constructor(opts: { userAgent: string; fetch?: Fetch; log?: (msg: string) => void }) {
    this.userAgent = opts.userAgent;
    this.fetch = opts.fetch ?? ((url) => fetch(url, { headers: { 'User-Agent': this.userAgent }, signal: AbortSignal.timeout(15_000) }));
    this.log = opts.log ?? (() => {});
  }

  start(): void {
    void this.loadInfo().then(() => this.loadStatus());
    this.timers.push(setInterval(() => void this.loadInfo(), 3600_000), setInterval(() => void this.loadStatus(), 60_000));
    for (const t of this.timers) t.unref();
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
  }

  async loadInfo(): Promise<void> {
    try {
      const res = await this.fetch(`${BASE}/station_information.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: { stations: InfoRow[] } };
      this.info = new Map(body.data.stations.map((s) => [s.station_id, s]));
    } catch (err) {
      this.log(`Bluebikes stations: ${(err as Error).message}`);
    }
  }

  async loadStatus(): Promise<void> {
    try {
      const res = await this.fetch(`${BASE}/station_status.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { last_updated: number; data: { stations: StatusRow[] } };
      this.status = new Map(body.data.stations.map((s) => [s.station_id, s]));
      this.updatedAt = body.last_updated * 1000;
    } catch (err) {
      this.log(`Bluebikes status: ${(err as Error).message}`);
    }
  }

  stations(): BikeStation[] {
    const out: BikeStation[] = [];
    for (const [id, s] of this.status) {
      const i = this.info.get(id);
      // Uninstalled stations report zeros and a placeholder time; leave them off the map.
      if (!i || s.is_installed !== 1) continue;
      out.push({
        id,
        name: i.name,
        latitude: i.lat,
        longitude: i.lon,
        capacity: i.capacity ?? null,
        bikes: s.num_bikes_available,
        ebikes: s.num_ebikes_available ?? 0,
        docks: s.num_docks_available,
        renting: s.is_renting === 1,
        returning: s.is_returning === 1,
        reportedAt: s.last_reported > 1e9 ? s.last_reported * 1000 : null,
      });
    }
    return out;
  }
}
