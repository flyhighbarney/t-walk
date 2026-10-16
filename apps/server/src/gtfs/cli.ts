// npm run gtfs:import — download (if changed) and import the MBTA GTFS feed.
// GTFS_DIR=fixtures/gtfs imports a local folder instead.

import { loadConfig } from '../config.ts';
import { refreshGtfs } from './import.ts';

const config = loadConfig();
const started = Date.now();
const result = await refreshGtfs({
  dataDir: config.dataDir,
  userAgent: config.userAgent,
  localSource: config.gtfsDir ?? undefined,
  force: process.argv.includes('--force'),
  log: (m) => console.log(m),
});
console.log(
  result.changed
    ? `Imported ${result.feedVersion ?? 'GTFS'} in ${((Date.now() - started) / 1000).toFixed(0)}s → ${result.dbPath}`
    : `GTFS unchanged (${result.feedVersion ?? 'unknown version'}); nothing to do.`,
);
