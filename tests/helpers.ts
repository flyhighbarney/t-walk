// Shared setup for the replay and API tests: the fixture GTFS feed imported
// once into a temporary database, and a server stack driven by a manual clock.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildApp } from '../apps/server/src/api/app.ts';
import { Boards } from '../apps/server/src/api/boards.ts';
import { GtfsDb } from '../apps/server/src/gtfs/db.ts';
import { importGtfs } from '../apps/server/src/gtfs/import.ts';
import { ManualClock } from '../apps/server/src/live/clock.ts';
import { Ingest } from '../apps/server/src/live/ingest.ts';
import { loadRecording, ReplayDriver } from '../apps/server/src/live/replay.ts';
import { LiveStore } from '../apps/server/src/live/store.ts';

export const ROOT = resolve(import.meta.dirname, '..');

let dbPromise: Promise<GtfsDb> | null = null;

export function fixtureDb(): Promise<GtfsDb> {
  dbPromise ??= (async () => {
    const dir = mkdtempSync(join(tmpdir(), 'twalk-test-'));
    const path = join(dir, 'gtfs.sqlite');
    await importGtfs(join(ROOT, 'fixtures/gtfs'), path);
    return new GtfsDb(path);
  })();
  return dbPromise;
}

export async function stack(opts: { scenario?: string; start: number }) {
  const db = await fixtureDb();
  const clock = new ManualClock(opts.start);
  const store = new LiveStore();
  const ingest = new Ingest({
    store,
    clock,
    routeType: (id) => (db.routes().get(id)?.mode === 'bus' ? 3 : 0),
    replay: true,
  });
  const driver = opts.scenario ? new ReplayDriver(loadRecording(join(ROOT, 'fixtures/replay', `${opts.scenario}.ndjson`)), ingest) : null;
  const boards = new Boards({ getDb: () => db, store, ingest, clock });
  const app = await buildApp({ getDb: () => db, boards, store, ingest, clock });
  /** Move the clock and apply everything recorded up to then. */
  const at = (t: number) => {
    clock.set(t);
    driver?.advanceTo(t);
  };
  at(opts.start);
  return { db, clock, store, ingest, driver, boards, app, at };
}
