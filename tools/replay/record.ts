// npm run record -- [minutes]
// Connects to the MBTA exactly as the server does and writes every upstream
// event to recordings/ (one NDJSON file per hour). Replay one with
// REPLAY_FILE=recordings/<file>.ndjson npm start.

import { loadConfig } from '../../apps/server/src/config.ts';
import { GtfsDb } from '../../apps/server/src/gtfs/db.ts';
import { currentDbPath } from '../../apps/server/src/gtfs/import.ts';
import { systemClock } from '../../apps/server/src/live/clock.ts';
import { Ingest } from '../../apps/server/src/live/ingest.ts';
import { LiveManager } from '../../apps/server/src/live/manager.ts';
import { Recorder } from '../../apps/server/src/live/recorder.ts';
import { LiveStore } from '../../apps/server/src/live/store.ts';
import { join } from 'node:path';

process.loadEnvFile?.(join(import.meta.dirname, '../../.env'));
const config = loadConfig();
const minutes = Number(process.argv[2] ?? 60);
const dbPath = await currentDbPath(config.dataDir);
if (!dbPath) throw new Error('Import GTFS first: npm run gtfs:import');
const db = new GtfsDb(dbPath);
const dir = config.recordDir ?? join(config.dataDir, '..', 'recordings');
const recorder = new Recorder(dir, { feedEveryMs: 30_000 });
const store = new LiveStore();
const ingest = new Ingest({ store, clock: systemClock, routeType: (id) => (db.routes().get(id)?.mode === 'bus' ? 3 : 0), log: console.log });
const manager = new LiveManager({
  apiKey: config.mbtaApiKey,
  userAgent: config.userAgent,
  clock: systemClock,
  ingest,
  routesByType: db.routeIdsByType(),
  recorder,
  log: console.log,
});
manager.start();
console.log(`Recording to ${dir} for ${minutes} min${config.mbtaApiKey ? '' : ' (no API key: GTFS-realtime only)'}…`);
const status = setInterval(
  () => console.log(`predictions ${store.predictions.items.size}, vehicles ${store.vehicles.items.size}, alerts ${store.alerts.items.size}`),
  30_000,
);
setTimeout(() => {
  clearInterval(status);
  manager.stop();
  recorder.close();
  console.log('Done.');
  process.exit(0);
}, minutes * 60_000);
