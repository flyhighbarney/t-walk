// Boot the live pipeline (GTFS-RT, no key), wait, and query the API in-process.
import { GtfsDb } from '../apps/server/src/gtfs/db.ts';
import { currentDbPath } from '../apps/server/src/gtfs/import.ts';
import { buildApp } from '../apps/server/src/api/app.ts';
import { Boards } from '../apps/server/src/api/boards.ts';
import { systemClock } from '../apps/server/src/live/clock.ts';
import { Ingest } from '../apps/server/src/live/ingest.ts';
import { LiveManager } from '../apps/server/src/live/manager.ts';
import { LiveStore } from '../apps/server/src/live/store.ts';
import { displayPrediction, displayScheduled, formatHeadway, type DepartureRow, type Mode } from '@twalk/core';
const db = new GtfsDb((await currentDbPath('data'))!);
const store = new LiveStore();
const ingest = new Ingest({ store, clock: systemClock, routeType: (id) => (db.routes().get(id)?.mode === 'bus' ? 3 : 0), log: console.log });
const m = new LiveManager({ apiKey: null, userAgent: 't-walk-dev', clock: systemClock, ingest, routesByType: db.routeIdsByType(), log: console.log });
m.start();
await new Promise((r) => setTimeout(r, 6000));
console.log('predictions', store.predictions.items.size, 'vehicles', store.vehicles.items.size);
const boards = new Boards({ getDb: () => db, store, ingest, clock: systemClock });
const app = await buildApp({ getDb: () => db, boards, clock: systemClock });
const t = performance.now();
const res = await app.inject({ url: `/api/nearby?lat=${process.argv[2] ?? 42.3564}&lon=${process.argv[3] ?? -71.0624}&limit=5` });
const body = res.json();
console.log('nearby', res.statusCode, (performance.now() - t).toFixed(0), 'ms', JSON.stringify(body).length, 'bytes');
console.log('health rail', body.status.predictions.heavy_rail.source, body.status.predictions.heavy_rail.state, 'age', ((Date.now()-body.status.predictions.heavy_rail.lastUpdateAt)/1000).toFixed(0)+'s');
const now = Date.now();
const txt = (r: DepartureRow, mode: Mode) => {
  if (r.source === 'scheduled' || r.source === 'vehicle') { const d = displayScheduled(now, r.scheduledTime!); return d.kind === 'hidden' ? '-' : d.text; }
  const d = displayPrediction({ mode, now, arrivalTime: r.arrivalTime, departureTime: r.departureTime, status: r.status, vehicleStoppedHere: r.vehicleStoppedHere });
  return d.kind === 'hidden' ? `(hidden: ${d.reason})` : d.text;
};
body.stops.forEach((s: any, i: number) => {
  console.log(`\n${s.name} [${s.id}] ~${Math.round(s.walk.seconds/60)} min walk ${s.entranceName ?? ''}`);
  for (const g of body.boards[i].groups) {
    const rows = g.rows.map((r: DepartureRow) => `${txt(r, g.mode)} ${r.headsign} [${r.source}${r.mayNotRun ? ' MAY NOT RUN' : ''}${r.canceled ? ' CANCELED' : ''}]`);
    console.log(`  ${g.routeId} ${g.directionName}: ${g.headway ? formatHeadway(g.headway.minMinutes, g.headway.maxMinutes).text + ' (scheduled)' : ''} ${rows.join(' | ')}`);
  }
});
m.stop(); await app.close(); process.exit(0);
