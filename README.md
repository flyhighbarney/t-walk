# T-Walk

Live MBTA departures near you, sorted by how long it takes to **walk** to each
stop, and a live map of every train, bus and boat around you.

- **Phase 1:** the server, the GTFS import, the "Now" screen, the replay harness
  and the time-zone tests.
- **Phase 2:** the live map (`/map`), Saved stops, the Stitch design
  (`design/stitch/`), and Bluebikes.

Accuracy rules:

- Every time is labelled **Live**, **Estimate** (the MBTA's own schedule-based
  "prediction", uncertainty code 300), **Scheduled · vehicle on route**, or
  **Scheduled**. Scheduled times are always clock times ("8:34 AM"), never
  countdowns, so they can't be mistaken for live ones.
- Countdowns follow the MBTA's [Real-Time Display Guidelines](https://www.mbta.com/developers/real-time-display-guidelines)
  (Arriving ≤ 30 s, Boarding, Now for buses, clock times for Commuter Rail,
  half-up minute rounding). There is no "Approaching": the MBTA dropped it in
  February 2026.
- Data age is shown and dimmed past 60 s (subway), 90 s (bus) or 120 s (rail/ferry).
  After 3 minutes without data, live times are dropped and the schedule is shown
  with a banner saying so.
- "May not run" flags a bus/rail trip that should have started three minutes
  ago and has nothing live on it, but only while the live feed is healthy and is
  tracking that route.
- **Vehicles on the map move honestly** (`packages/core/src/motion.ts`):
  - On each new report, a marker glides along its route line to the reported point over 1 s.
  - Between reports, a moving vehicle continues at the speed measured from its last two
    reports, for at most 10 s, and never past the stop it's heading for.
  - Not heard from for 60 s (subway), 90 s (bus) or 120 s (rail/ferry), it freezes exactly
    where it was last reported, greys out and shows its age ("2 min ago").
  - Off its line (detours, shuttles): reported points only.
  - Reduced motion: reported points only, no gliding.

## Layout

```
packages/core     Pure logic shared by server and browser: Boston time and GTFS service
                  days, calendars, display rules, the departure merge, walking, "can I make it"
apps/server       Fastify server: the only thing that talks to the MBTA
  src/gtfs        GTFS download (conditional) → SQLite import → queries
  src/live        V3 SSE streams, GTFS-realtime fallback, store, health, recorder, replay
  src/api         HTTP API and the SSE fan-out to browsers
apps/web          Vite + React + Tailwind PWA: Now, Map (lazy-loaded MapLibre), Saved
  src/screens/map MapScreen, vehicleAnimator (frames), mapData (hooks), mapStyle, sheets
design/stitch     The Stitch screens (HTML + PNG), DESIGN.md, and where the app departs from them
fixtures/gtfs     A tiny made-up GTFS feed (Park Street, a bus stop, South Station…)
fixtures/replay   Made-up scenarios in the recorder's format (see below)
tests/            Replay and API tests;  e2e/  Playwright tests
tools/            replay/record.ts, replay/make-fixtures.ts, lighthouse.ts, smoke-live.ts, make-icons.ts
```

## Setup

Needs **Node 24+** (the server runs TypeScript directly with Node's type
stripping and uses the built-in `node:sqlite`; no native modules).

```bash
npm install
cp .env.example .env        # then put your MBTA API key in it
npm run gtfs:import         # downloads and imports the MBTA feed (~1 min, ~270 MB)
npm run build               # builds the web app into apps/web/dist
npm start                   # server on http://127.0.0.1:8787, serving the app too
```

For development, run the server and Vite side by side (Vite proxies `/api`):

```bash
npm run dev:server
npm run dev:web             # http://localhost:5173
```

### Environment variables

| Variable | Meaning |
|---|---|
| `MBTA_API_KEY` | V3 API key ([portal](https://api-v3.mbta.com/portal)). Without it the server uses the public GTFS-realtime feeds only: polled every 10 s, no alerts. |
| `PORT`, `HOST` | Where the server listens (default `8787`, `127.0.0.1`). |
| `DATA_DIR` | Imported GTFS databases (default `./data`). |
| `CONTACT` | Sent in the User-Agent to the MBTA and api.weather.gov, which ask for one. |
| `GTFS_DIR` | Import a folder of GTFS `.txt` files instead of downloading (tests, offline). |
| `REPLAY_FILE` | Replay a recording instead of connecting to the MBTA. |
| `FAKE_NOW` | Start the clock at this ISO time (with `REPLAY_FILE`). |
| `RECORD_DIR` | Record every upstream event while running. |

Secrets live only in `.env`, which is git-ignored.

## The map

- **Basemap:** OpenFreeMap (no key, no request limits, no SLA): its dark style
  turned down to the design's navy, or Positron in light mode. If it can't be
  fetched, the map draws on a plain background, so the transit layers still show.
  Tiles, styles and fonts are cached by the service worker.
- **Route lines** come from the GTFS shapes: for each route and direction, the
  most-used shape plus any branch used by 15% or more of trips. They are
  simplified to 4 m, served once per feed, and cached with an ETag. Rail and
  ferry lines are always drawn. A bus route's line is fetched when its vehicles
  are in view, used for snapping, and drawn when you select the bus.
- **Vehicles** stream for the area in view, plus half its size around it, over
  `/api/map/vehicles` (gzipped SSE: a snapshot, then only vehicles that changed).
  Buses appear from street-level zoom (12.5).
- **Sheets:** a vehicle's next stops (live predictions), a stop's departures
  (the same rows as Now, with line filters), Bluebikes counts, layers, and
  **In view**: a text list of the vehicles and stations on screen. That list is
  the way into the map without seeing it.
- **Bluebikes:** GBFS 2.3 from `gbfs.lyft.com/gbfs/2.3/bos`. Stations refresh
  hourly, counts every minute. The layer is fetched only while it's on and the
  page is visible.
- The MapLibre bundle (~295 KB gzipped) loads only when the Map tab is opened,
  and is not precached at install.

## How live data flows

```
MBTA V3 API ──SSE──┐  predictions (rail), predictions (bus), vehicles, alerts
                   ├─► Ingest ─► LiveStore ─► Boards ─► /api/live (SSE, changed boards only)
cdn.mbta.com ─poll─┘  GTFS-realtime: no-key mode, and fallback when a V3 stream is down
```

- **Four upstream streams, not one.** `/predictions` refuses `filter[route_type]`
  alone (HTTP 400), so predictions are filtered by every route id, split into
  rail and bus so each can fail and reset on its own. Each open stream counts as
  one request against the rate limit.
- **Fallback.** If a V3 prediction or vehicle stream is unusable for 20 s, the
  GTFS-realtime poller starts and stands in for it (same prediction ids, so no
  duplicates); it stops once the streams have been back for a minute. The
  banner says when the backup feed is in use.
- **Data age.** V3 predictions carry no timestamp and the stream only sends
  changes, so while connected the data is as current as the last event; while
  reconnecting it ages from the moment the stream closed. GTFS-realtime uses the
  feed header's timestamp.
- **Browsers** get a snapshot and then only boards that changed, checked once a
  second, with a status keep-alive every 15 s. Both live streams are gzipped. The connection closes when the tab
  is hidden and reopens (with a fresh snapshot) when it's visible. Countdowns
  tick locally against the server's clock.
- **GTFS refresh.** Checked every 6 hours with `If-None-Match` /
  `If-Modified-Since`; a new feed is imported into a fresh SQLite file and
  swapped in.

## Tests

```bash
npm test                    # Vitest: core, motion, adapters, replay scenarios, API, map (99 tests)
npm run test:e2e            # builds, then Playwright on two replay servers (11 tests, incl. axe on Now and Map)
npm run lighthouse          # builds, then a mobile Lighthouse run of Now on the replay
npm run lighthouse -- map   # the same for the Map screen
npm run typecheck && npm run lint
```

Time-zone tests (`packages/core/src/time.test.ts`) cover times past 24:00, both
2026 DST days under GTFS's "noon minus 12 h" rule, a late-night trip across the
fall-back change, Boston-vs-UTC dates, and a holiday that swaps weekday service
for Saturday's.

## Replay harness

Everything the server receives upstream is an `UpstreamEvent` (`open`, `close`,
or a raw `message`), and the same `Ingest.handle` path applies live and replayed
events, so a replay exercises the real parsing.

- **Record** a real morning (needs the GTFS import; uses the API key if set):
  `npm run record -- 90` writes `recordings/YYYYMMDD-HHZ.ndjson` for 90 minutes.
  GTFS-realtime polls are large, so the recorder keeps one every 30 s.
- **Replay** in the server: `REPLAY_FILE=recordings/<file>.ndjson npm start`
  (the clock starts at the first event; add `FAKE_NOW=…` to start elsewhere).
- **In tests**, `tests/helpers.ts` builds the full stack on a `ManualClock`, and
  `driver.advanceTo(t)` applies events up to `t`.
- **Scenarios** in `fixtures/replay/` are generated by `npm run fixtures` against
  `fixtures/gtfs/`: `normal`, `delays` (stalled bus, delayed train, ghost trip),
  `outage` (all streams drop for 5 minutes), `fallback` (V3 drops, GTFS-realtime
  takes over) and `late-night` (Thursday's 25:10 trip at 1 AM Friday). They are
  made up, in the same format as real recordings.

To try the app with made-up data and no key:

```bash
GTFS_DIR=fixtures/gtfs DATA_DIR=data-fixture REPLAY_FILE=fixtures/replay/normal.ndjson \
  FAKE_NOW=2026-10-15T08:00:00-04:00 npm start
```

…and allow location near Park Street (42.3566, -71.0623).

## Lighthouse (mobile, 2026-10-16)

| Screen | Performance | Accessibility | Best practices |
|---|---|---|---|
| Now (landing) | 97 (FCP 1.7 s, LCP 1.9 s) | 100 | 100 |
| Map | 51 (TBT 5.8 s) | 100 | 100 |

The Map's score is MapLibre starting its WebGL engine and decoding vector tiles
on Lighthouse's 4× slowed CPU. Ways to bring it up are listed under known gaps.

## Known gaps

- **Map performance on slow phones** (Lighthouse 51). Options: draw a static
  preview first and start MapLibre on first touch; cap the device pixel ratio;
  fewer basemap layers; raster tiles at low zoom.
- **Shuttles and diversions** are drawn only as their buses (shuttle routes are
  in the feed). Outlining a diversion from its alert needs alerts, so an API key.
- **Alerts and elevator status** need `MBTA_API_KEY` (the V3 stream).
- **The V3 streaming path is untested against live data** until a key is set;
  the GTFS-realtime path is what ran on live data.
- **Walking times are straight-line × 1.3** until OpenTripPlanner (Phase 3).
  The map's walk circle is labelled "about".
- **The MassDOT Developers License** hasn't been read yet. Read it before anything goes public.

## Privacy

No account. Pinned stops, walking pace and the location opt-in are stored on
the device. Location is read only while the page is open and visible, rounded
to about 11 m, sent to the T-Walk server for the nearby lookup, and not logged
or stored there.

## Data and attribution

Data from the MBTA under the MassDOT Developers License Agreement. T-Walk is
not affiliated with the MBTA.
