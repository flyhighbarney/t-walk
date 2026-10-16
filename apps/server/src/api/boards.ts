// Builds a stop's departure board from the GTFS database and the live store,
// with caching so that many browsers watching one stop cost one build.

import {
  buildDepartures,
  type LiveStatus,
  type Mode,
  type ScheduledStopTime,
  type StopBoard,
} from '@twalk/core';
import type { GtfsDb } from '../gtfs/db.ts';
import type { Clock } from '../live/clock.ts';
import type { Ingest } from '../live/ingest.ts';
import type { LiveStore } from '../live/store.ts';

const MODES: Mode[] = ['light_rail', 'heavy_rail', 'commuter_rail', 'bus', 'ferry'];
/** Schedules are fetched for this window and refetched once it has slid a minute. */
const SCHEDULE_BACK_MS = 2 * 60_000;
const SCHEDULE_AHEAD_MS = 120 * 60_000;
/** Rebuild at least this often even if nothing changed (the schedule window moves). */
const MAX_BOARD_AGE_MS = 15_000;

export class Boards {
  private readonly getDb: () => GtfsDb;
  private readonly store: LiveStore;
  private readonly ingest: Ingest;
  private readonly clock: Clock;
  private platforms = new Map<string, string[]>();
  private schedules = new Map<string, { from: number; rows: ScheduledStopTime[] }>();
  private boards = new Map<string, { key: string; at: number; board: StopBoard; json: string }>();
  private dbPath = '';

  constructor(opts: { getDb: () => GtfsDb; store: LiveStore; ingest: Ingest; clock: Clock }) {
    this.getDb = opts.getDb;
    this.store = opts.store;
    this.ingest = opts.ingest;
    this.clock = opts.clock;
  }

  private db(): GtfsDb {
    const db = this.getDb();
    if (db.path !== this.dbPath) {
      // A new feed was imported: everything derived from the old one goes.
      this.dbPath = db.path;
      this.platforms.clear();
      this.schedules.clear();
      this.boards.clear();
    }
    return db;
  }

  private platformIds(stopId: string): string[] {
    let p = this.platforms.get(stopId);
    if (!p) {
      p = this.db().platformIds(stopId);
      this.platforms.set(stopId, p);
    }
    return p;
  }

  private scheduleRows(stopId: string, now: number): ScheduledStopTime[] {
    const cached = this.schedules.get(stopId);
    if (cached && now - cached.from < 60_000) return cached.rows;
    const from = now - SCHEDULE_BACK_MS;
    const rows = this.db().schedules(this.platformIds(stopId), from, now + SCHEDULE_AHEAD_MS);
    if (this.schedules.size > 2000) this.schedules.clear();
    this.schedules.set(stopId, { from: now, rows });
    return rows;
  }

  status(): LiveStatus {
    const predictions = Object.fromEntries(MODES.map((m) => [m, this.ingest.predictionHealth(m)])) as LiveStatus['predictions'];
    return {
      now: this.clock.now(),
      predictions,
      vehicles: this.ingest.vehicleHealth(),
      alerts: this.ingest.alertHealth(),
      gtfsVersion: this.getDb().feedVersion,
    };
  }

  private healthKey(): string {
    return MODES.map((m) => this.ingest.predictionHealth(m).state).join('') + this.ingest.vehicleHealth().state;
  }

  /** The board and its JSON (for change detection when streaming). */
  boardWithJson(stopId: string): { board: StopBoard; json: string } {
    const db = this.db();
    const now = this.clock.now();
    const key = `${this.store.version}|${this.ingest.healthVersion}|${this.healthKey()}`;
    const cached = this.boards.get(stopId);
    if (cached && cached.key === key && now - cached.at < MAX_BOARD_AGE_MS) return cached;

    const platforms = this.platformIds(stopId);
    const groups = buildDepartures({
      now,
      routes: db.routes(),
      predictions: this.store.predictionsAtStops(platforms),
      schedules: this.scheduleRows(stopId, now),
      vehicles: this.store.vehicles.items,
      stopIds: new Set(platforms),
      platformCodes: db.platformCodes(platforms),
      tripHeadsign: (tripId) => db.tripHeadsign(tripId),
      derivedHeadsign: (tripId) => {
        // Only a stop further along counts; this one isn't where the train is going.
        const last = this.store.lastPredictedStop(tripId);
        return last && !platforms.includes(last) ? (db.stop(db.topLevelId(last))?.name ?? null) : null;
      },
      trackedRoutes: this.store.trackedRoutes(),
      health: (mode) => this.ingest.predictionHealth(mode),
    });
    const board: StopBoard = { stopId, groups, generatedAt: now };
    // generatedAt is left out of the comparison so an unchanged board isn't resent.
    const json = JSON.stringify(groups);
    const entry = { key, at: now, board, json };
    if (this.boards.size > 2000) this.boards.clear();
    this.boards.set(stopId, entry);
    return entry;
  }

  board(stopId: string): StopBoard {
    return this.boardWithJson(stopId).board;
  }
}
