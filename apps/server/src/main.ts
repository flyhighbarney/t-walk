// T-Walk server: the only thing that talks to the MBTA.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FareRules } from '@twalk/core';
import { loadConfig, REPO_ROOT } from './config.ts';
import { GtfsDb } from './gtfs/db.ts';
import { currentDbPath, pruneOldDatabases, refreshGtfs } from './gtfs/import.ts';
import { buildApp } from './api/app.ts';
import { Boards } from './api/boards.ts';
import { OffsetClock, systemClock, type Clock } from './live/clock.ts';
import { Ingest } from './live/ingest.ts';
import { LiveManager } from './live/manager.ts';
import { DelayRecorder } from './live/delays.ts';
import { Recorder } from './live/recorder.ts';
import { BikesFeed } from './live/bikes.ts';
import { Planner } from './plan/planner.ts';
import { Geocoder } from './plan/geocode.ts';
import { PushStore } from './push/store.ts';
import { CommuteNotifier } from './push/notifier.ts';
import { WebPushSender } from './push/routes.ts';
import { Weather } from './push/weather.ts';
import { mkdirSync } from 'node:fs';
import { loadRecording, ReplayDriver } from './live/replay.ts';
import { LiveStore } from './live/store.ts';

const GTFS_CHECK_EVERY_MS = 6 * 3600_000;

const config = loadConfig();
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

async function openDb(): Promise<GtfsDb> {
  let path = await currentDbPath(config.dataDir);
  if (!path || config.gtfsDir) {
    log(config.gtfsDir ? `Importing GTFS from ${config.gtfsDir}` : 'No GTFS imported yet; downloading (about a minute)…');
    path = (await refreshGtfs({ dataDir: config.dataDir, userAgent: config.userAgent, localSource: config.gtfsDir ?? undefined, log })).dbPath;
  }
  if (!path) throw new Error('GTFS import produced no database');
  return new GtfsDb(path);
}

let db = await openDb();
log(`GTFS: ${db.feedVersion ?? 'unknown version'}`);

const replayEvents = config.replayFile ? loadRecording(config.replayFile) : null;
const clock: Clock =
  replayEvents || config.fakeNow != null
    ? new OffsetClock(config.fakeNow ?? replayEvents?.[0]?.t ?? Date.now())
    : systemClock;

const store = new LiveStore();
const ingest = new Ingest({
  store,
  clock,
  routeType: (id) => {
    const mode = db.routes().get(id)?.mode;
    return mode === 'bus' ? 3 : mode ? 0 : undefined;
  },
  log,
  replay: replayEvents != null,
});

let manager: LiveManager | null = null;
let replay: ReplayDriver | null = null;
if (replayEvents) {
  log(`Replaying ${replayEvents.length} events from ${config.replayFile}`);
  replay = new ReplayDriver(replayEvents, ingest);
  replay.follow(clock);
} else {
  manager = new LiveManager({
    apiKey: config.mbtaApiKey,
    userAgent: config.userAgent,
    clock,
    ingest,
    routesByType: db.routeIdsByType(),
    recorder: config.recordDir ? new Recorder(config.recordDir) : null,
    log,
  });
  manager.start();
}

// Bluebikes is live-only (a replay has no bike data to go with it).
const bikes = replayEvents ? null : new BikesFeed({ userAgent: config.userAgent, log });
bikes?.start();

const boards = new Boards({ getDb: () => db, store, ingest, clock });
const fareRules = JSON.parse(readFileSync(join(REPO_ROOT, 'config', 'fares.json'), 'utf8')) as FareRules;
// Arrival history: how late each line really ran against what riders were shown, kept in data/history.json.
const historyPath = join(config.dataDir, 'history.json');
const delays = DelayRecorder.load(historyPath, () => clock.now());
store.observer = delays;
const historyTimer = setInterval(() => delays.save(historyPath), 5 * 60_000);
historyTimer.unref();
const planner = new Planner({ otpUrl: config.otpUrl, getDb: () => db, store, ingest, clock, fareRules, history: delays.history });
const geocoder = new Geocoder({ userAgent: config.userAgent, getDb: () => db, baseUrl: config.photonUrl });
// Leave-now notifications: only with VAPID keys (npm run push:keys) and not in replay mode.
let push: { store: PushStore; sender: WebPushSender; publicKey: string } | null = null;
if (config.vapid && !replayEvents) {
  mkdirSync(config.dataDir, { recursive: true });
  const pushStore = new PushStore(join(config.dataDir, 'push.sqlite'));
  const sender = new WebPushSender(config.vapid);
  const weather = new Weather({ userAgent: config.userAgent });
  new CommuteNotifier({
    store: pushStore,
    plan: (req) => planner.plan(req),
    alerts: () => [...store.alerts.items.values()],
    weather: (lat, lon, at) => weather.at(lat, lon, at),
    clock,
    sender,
    log,
  }).start();
  push = { store: pushStore, sender, publicKey: config.vapid.publicKey };
  log(`Leave-now notifications on (${pushStore.all().length} commutes)`);
} else if (!config.vapid) {
  log('No VAPID keys: leave-now notifications are off (npm run push:keys to turn them on).');
}

const app = await buildApp({ getDb: () => db, boards, store, bikes, planner, geocoder, ingest, push, clock, webDist: config.webDist, logger: false });
await app.listen({ port: config.port, host: config.host });
log(`Listening on http://${config.host}:${config.port}`);

// Pick up new GTFS feeds (the MBTA publishes several a week). Not in replay or local-GTFS mode.
if (!replayEvents && !config.gtfsDir) {
  setInterval(async () => {
    try {
      const r = await refreshGtfs({ dataDir: config.dataDir, userAgent: config.userAgent, log });
      if (r.changed && r.dbPath) {
        const old = db;
        db = new GtfsDb(r.dbPath);
        old.close();
        await pruneOldDatabases(config.dataDir, r.dbPath);
        log(`Switched to GTFS ${db.feedVersion}`);
      }
    } catch (err) {
      log(`GTFS check failed: ${(err as Error).message}`);
    }
  }, GTFS_CHECK_EVERY_MS).unref();
}

const shutdown = async () => {
  manager?.stop();
  bikes?.stop();
  replay?.stop();
  clearInterval(historyTimer);
  delays.save(historyPath);
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
