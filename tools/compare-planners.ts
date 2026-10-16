// Compare the built-in planner with OpenTripPlanner on the real timetable.
//
//   node --disable-warning=ExperimentalWarning tools/compare-planners.ts [--otp http://127.0.0.1:8080] [--date 2026-10-19] [--time 08:00]
//
// Needs an imported GTFS database (npm run gtfs:import) and a running OTP built
// on the same feed (npm run otp:serve). Prints each trip's arrival by both and
// the difference; the built-in planner's walks are straight-line estimates, so
// a few minutes either way is expected.

import { zonedTimeToInstant, WALK_SPEED, type PlanSort } from '@twalk/core';
import { loadConfig } from '../apps/server/src/config.ts';
import { GtfsDb } from '../apps/server/src/gtfs/db.ts';
import { currentDbPath } from '../apps/server/src/gtfs/import.ts';
import { planBuiltin } from '../apps/server/src/plan/builtin.ts';
import { queryOtp } from '../apps/server/src/plan/otp.ts';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : fallback;
};

const PLACES: Record<string, [number, number]> = {
  'Park Street': [42.3564, -71.0624],
  'Harvard Yard': [42.3745, -71.1166],
  Northeastern: [42.3398, -71.0892],
  'Fenway Park': [42.3467, -71.0972],
  'Logan Airport': [42.3656, -71.0096],
  'Davis Square': [42.3967, -71.1225],
  'JP Centre St': [42.3105, -71.1143],
  'Fields Corner': [42.3001, -71.0617],
  'Quincy Center': [42.2513, -71.0054],
  'Kendall/MIT': [42.3625, -71.0862],
  'Back Bay': [42.3473, -71.0752],
  'Chelsea Square': [42.3943, -71.0331],
  'Brookline Village': [42.3327, -71.1167],
  'Malden Center': [42.4266, -71.0741],
  'South Station': [42.3523, -71.0552],
  'Allston Union Sq': [42.3532, -71.1325],
};
const PAIRS: [string, string][] = [
  ['Park Street', 'Harvard Yard'],
  ['Northeastern', 'Kendall/MIT'],
  ['Fenway Park', 'Logan Airport'],
  ['Davis Square', 'Back Bay'],
  ['JP Centre St', 'South Station'],
  ['Fields Corner', 'Harvard Yard'],
  ['Quincy Center', 'Northeastern'],
  ['Chelsea Square', 'Park Street'],
  ['Brookline Village', 'Kendall/MIT'],
  ['Malden Center', 'Fenway Park'],
  ['Allston Union Sq', 'South Station'],
  ['Logan Airport', 'Davis Square'],
  ['Back Bay', 'Quincy Center'],
  ['Harvard Yard', 'Fields Corner'],
  ['Kendall/MIT', 'JP Centre St'],
];

const config = loadConfig();
const dbPath = await currentDbPath(config.dataDir);
if (!dbPath) throw new Error('No GTFS imported: run npm run gtfs:import');
const db = new GtfsDb(dbPath);
const [y, mo, d] = arg('date', '2026-10-19').split('-').map(Number) as [number, number, number];
const [h, mi] = arg('time', '08:00').split(':').map(Number) as [number, number];
const time = zonedTimeToInstant(y, mo, d, h, mi);
const otp = arg('otp', 'http://127.0.0.1:8080');
const helpers = { label: () => null, predictions: () => [], nextGap: () => null, historyBuffer: () => null };
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

let t0 = Date.now();
db.timetable();
console.log(`network built in ${Date.now() - t0} ms`);
t0 = Date.now();
await db.timetable().day(arg('date', '2026-10-19').replaceAll('-', ''));
console.log(`day built in ${Date.now() - t0} ms\n`);

const diffs: number[] = [];
for (const [a, b] of PAIRS) {
  const from = { lat: PLACES[a]![0], lon: PLACES[a]![1], name: a };
  const to = { lat: PLACES[b]![0], lon: PLACES[b]![1], name: b };
  t0 = Date.now();
  const mine = (await planBuiltin(db, { from, to, time, arriveBy: false, stepFree: false, pace: 'normal', sort: 'fastest' as PlanSort, avoidRoutes: [] }, time, helpers))[0];
  const ms = Date.now() - t0;
  const theirs = await queryOtp(otp, { from, to, time, arriveBy: false, stepFree: false, walkSpeed: WALK_SPEED.normal, flavor: 'fastest' });
  const best = theirs.itineraries.map((it) => Date.parse(String(it.end))).filter(Number.isFinite).sort((p, q) => p - q)[0];
  if (!mine || best == null) {
    console.log(`${a} → ${b}: ${mine ? '' : 'built-in found nothing'} ${best == null ? 'OTP found nothing' : ''}`);
    continue;
  }
  const diff = Math.round((mine.end - best) / 60_000);
  diffs.push(diff);
  const route = mine.legs.filter((l) => l.transit).map((l) => l.routeLabel).join(' › ') || 'walk';
  console.log(`${a} → ${b}: built-in ${clock(mine.end)} (${route}, ${ms} ms) · OTP ${clock(best)} · ${diff >= 0 ? '+' : ''}${diff} min`);
}
const abs = diffs.map(Math.abs).sort((p, q) => p - q);
console.log(`\n${diffs.length} trips: median difference ${abs[Math.floor(abs.length / 2)]} min, within 5 min ${abs.filter((x) => x <= 5).length}/${abs.length}, worst ${abs.at(-1)} min`);
