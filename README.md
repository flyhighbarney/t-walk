# T-Walk

Live MBTA departures near you, sorted by how long it takes to **walk** to each
stop, and a live map of every train, bus and boat around you.

- **Phase 1:** the server, the GTFS import, the "Now" screen, the replay harness
  and the time-zone tests.
- **Phase 2:** the live map (`/map`), Saved stops, the Stitch design
  (`design/stitch/`), and Bluebikes.
- **Phase 3:** the door-to-door trip planner (`/trips`) on OpenTripPlanner 2.10,
  with live data, four ways to sort, step-free mode, transfer risk, fares and
  "What if I miss it?".
- **Phase 4:** saved commutes with "Leave by", leave-now push notifications,
  backup plans around disruptions, alerts for your stops and lines, and offline
  mode.
- **Phase 5:** navigation like Apple Maps / Google Maps: Start on any trip opens a
  follow-me map, turn-by-turn walking, live departure and stop counts on board
  ("Your stop is next"), shareable ETA links, and a learned walking pace. Roboto
  font, and the fixes from a UI/UX audit (`docs/ux-audit-phase5.md`).

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

## Trip planner (OpenTripPlanner)

OTP 2.10 needs **Java 25** (Eclipse Temurin: `winget install EclipseAdoptium.Temurin.25.JDK`).

```bash
npm run otp:fetch     # OTP jar (sha1-checked), Massachusetts + Rhode Island OSM (md5-checked), MBTA GTFS
npm run otp:build     # graph build: about 3.5 min and a 5 GB heap here (Massachusetts + Rhode Island)
npm run otp:serve     # http://127.0.0.1:8080 (GraphQL /otp/gtfs/v1, debug UI at /)
```

Configs are in `otp/*.json`. They are copied next to the data in `otp/data/` (git-ignored) before each run.
OTP polls the MBTA's public GTFS-realtime feeds itself (trip updates and vehicle positions every 15 s, alerts every 30 s), so it needs no key.
Rhode Island is included because Commuter Rail runs to Providence and Wickford Junction.

`/api/plan` asks OTP the question three ways in parallel and merges the answers:
- fastest
- less walking (walk reluctance 6)
- fewer transfers (transfer cost 20 min)

Step-free mode turns on OTP's wheelchair routing for all three.

- **Labels:** OTP doesn't know the MBTA's "uncertainty 300" code (schedule-based), so each ride is relabelled from our own live store: Live, Estimate or Scheduled. Subway legs with no matching prediction are Scheduled, because the MBTA runs most subway trips as unscheduled (ADDED) trips.
- **Transfer risk:** the spare time after the walk between rides, against how far the incoming arrival could still move: 1 min for a live train, 2 min for a live bus, 3 min for an estimate, 3–5 min for a timetable time. Shown as Easy, Tight or Risky transfer, with an icon and a word. A risky trip suggests a safer one arriving up to 12 min later. Once the server has recorded enough live arrivals for a route and stop (8+ samples, saved in `data/history.json`), the buffer grows by how late that ride usually runs (80th percentile, up to 5 min), and the transfer text says "the ride before usually runs N min late". Until then the app says there's no history.
- **Walk it:** walking all the way is kept when it's under 40 min, or within 5 min of the fastest ride.
- **"What if I miss it?":** re-plans from that ride's stop one minute after it leaves.
- **Fares:** each ride's single fare comes from the MBTA's own fare tables, through OTP's GTFS Fares v2 support (`FaresV2` flag, `fares: "gtfs"`). The quoted fare is tap-to-pay, the same as CharlieCard, never the $0 "Free fare" product for qualifying riders. Transfers come from the configurable table in `config/fares.json`, keyed by each route's MBTA fare class:
  - free: subway↔subway, bus↔bus, subway→bus
  - pay the difference: bus→subway
  - no transfer discount: Commuter Rail and ferries
  - window: 2 hours

  OTP's own totals aren't used, because they ignore the MBTA's fare-medium transfer rules: subway then bus came out as $4.10 instead of $2.40. A ride without a price shows no total rather than a guess.
- **Stay on board:** when a bus or train carries on as a new trip number (e.g. SL1), it's shown as "Stay on board", not counted as a transfer.
- **Places:** our stops first, then Photon (photon.komoot.io, OpenStreetMap data) for addresses and places. Photon is used because Nominatim's usage policy doesn't allow search-as-you-type. Requests are proxied, cached for 24 h, spaced at least 250 ms apart, biased to where you are and kept to the MBTA area. If Photon is down, stops and stations still work.

`tools/fake-otp.ts` stands in for OTP and Photon (it answers with `fixtures/otp/plan.json`, moved to the time asked). The tests and end-to-end tests use it; you can too:

```bash
node tools/fake-otp.ts 8792
```

Then start the server with `OTP_URL=http://127.0.0.1:8792` and `PHOTON_URL=http://127.0.0.1:8792/api/`.

## Commutes, notifications, alerts, offline

- **Alerts** come from the MBTA's public feed (`cdn.mbta.com/realtime/Alerts_enhanced.json`, no key needed), or from the V3 stream when there's a key.
  - A stop shows its own alerts and whole-line alerts for its lines; a trip or commute shows alerts for its lines and the stops it uses (`packages/core/src/alerts.ts`).
  - Elevator outages show only in step-free mode, where they're highlighted.
  - Planned work shows up to a week ahead ("From 8:00 PM tomorrow to 4:00 PM Monday").
  - Three are shown, the rest behind "N more".
- **Commutes** (Saved tab) are stored on the device: from, to, arrive-by or leave-at time, days, step-free. From 3 hours before, the card shows today's plan with "Leave by", its route, transfer risk and alerts.
- **Leave-now notifications** (`apps/server/src/push/`) are opt-in per commute.
  - Turning them on sends that commute and the device's push address to the server (`data/push.sqlite`); turning them off deletes them there.
  - From 90 minutes before, the server re-plans every 2 minutes with live data and the NWS hourly forecast (2 min extra in rain, 4 in snow), and sends "Leave in 4 min to catch the 8:24 AM Orange Line" 5 minutes before you need to leave.
  - It sends again only if the time moves by 3 minutes or more.
  - If a suspension, shuttle, closure or detour hits a line the commute uses, it plans around that line (OTP's `transit.filters.exclude`) and sends the backup once, up to 75 minutes ahead.
  - Needs VAPID keys: `npm run push:keys` adds them to `.env`.
  - On iPhone and iPad, web push only works once T-Walk is on the Home Screen (iOS 16.4+).
- **Offline:**
  - While online, the app keeps the next 24 h of timetable for your saved stops and the stops near you in IndexedDB (`/api/offline/pack`, refreshed every 3 h).
  - Offline, Now and Saved build boards from it with the same rules as the server, labelled Scheduled, with a banner giving when it was saved.
  - The last known difference between the device and server clocks is kept, so times stay right offline too.

## Navigation (Phase 5)

Open a trip on Trips and tap **Start** (`/go`). The logic is pure and tested (`packages/core/src/nav.ts`); the screen is `apps/web/src/screens/go/`.

- **Banner:** the next instruction, with how far ahead it is, in feet and miles. Walks use OTP's step positions ("Turn left on Winter St · 550 ft"). Waiting shows the line, the platform and where to get off. On board it shows "Get off in 3 stops", "Your stop is next" (phone buzzes) and "Get off at …" (buzzes harder; a notification if T-Walk is in the background and notifications are allowed).
- **Map:** follows you, turned the way you face (compass, or GPS course while moving) and tilted. Touch it and it stops following until **Re-center**. Done legs turn grey. The vehicle you're waiting for or riding is drawn from its live reports.
- **Live tracking:** `GET /api/trips/:tripId/live` gives the vehicle running your trip and the trip's remaining stops with predictions. It's polled every 10 s, or every 5 s when your stop is within two.
- **Underground,** where there's no GPS: once you're on board (tap **I'm on board**, or T-Walk sees you move off along the line), the vehicle's reports stand in for you. You're drawn hollow, with "Following the train's live position".
- **Honesty:** stop counts come from the vehicle's live position or yours, never from elapsed time. With neither, it just says "Ride to …". A fix older than 45 s or vaguer than 80 m doesn't move you along a walk. Times say Live or Scheduled.
- **Off the route,** or too slow to make the departure: **Re-plan from here**.
- **Keeps going** across a reload (the trip is kept on the device). Trips and Now show **Trip in progress · Resume**. The screen stays on while navigating, where the browser allows it.
- **Share ETA** makes a link (`/share/:id`) that shows only the expected arrival and a short status ("On the Red Line, 3 stops to go"), never a location.
  - It's kept in server memory only.
  - It ends when you stop sharing or end the trip, 15 minutes after you arrive, or after 6 hours.
  - Updates need the link's secret token.
- **Learned pace** (opt-in, Saved): navigated walks with good GPS are timed. After about a quarter mile, the average speed (including waits at crossings) is kept on the device and used for navigation ETAs. Saved offers the nearest pace for planning, and **Forget it**.
- **Routes in the URL:** Trips keeps from, to, time and sort in the URL, so refresh and shared links work. The open trip is a history step, so Back closes it. Map sheets (`?stop=`, `?vehicle=`, `?bike=`, `?sheet=`) work the same way.

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
npm test                    # Vitest: core, motion, trips, fares, alerts, commutes, adapters, replay, API, map, planner, push (177 tests)
npm run smoke:plan          # real trips through a running server and OTP
npm run test:e2e            # builds, then Playwright with replay servers and a stand-in OTP (22 tests: offline, commutes, alerts, navigation, sharing, Back on Map and Trips, axe on Now, Map, Trips, navigation)
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
| Now (landing) | 97 (FCP 1.9 s, LCP 2.2 s, CLS 0; Roboto self-hosted) | 100 | 100 |
| Map | 51 (TBT 5.8 s) | 100 | 100 |

The Map's score is MapLibre starting its WebGL engine and decoding vector tiles
on Lighthouse's 4× slowed CPU. Ways to bring it up are listed under known gaps.

## Known gaps

- **Map performance on slow phones** (Lighthouse 51). Options: draw a static
  preview first and start MapLibre on first touch; cap the device pixel ratio;
  fewer basemap layers; raster tiles at low zoom.
- **Shuttles and diversions** are drawn only as their buses (shuttle routes are
  in the feed). Outlining a diversion from its alert needs alerts, so an API key.
- **Push notifications haven't been tested on a real phone yet**, only through the server's own tests. Headless browsers can't subscribe to a push service.
- **Personal commute stats** (average time, on-time rate) need records of trips actually taken. Navigation could log them (opt-in); not built yet.
- **Navigation hasn't been walked on a real phone yet.** It was tested with simulated GPS (Playwright and the browser pane): compass, wake lock, vibration and background notifications need a device.
- **Walking preferences beyond step-free** (well-lit streets, fewer hills, crosswalks) aren't offered: there's no trustworthy data for them in OTP's graph yet. Best entrance and weather-aware leave times exist (OTP's station entrances; NWS rain/snow in leave-now notifications), not as separate settings.
- **Transfer pathways** inside stations come from OTP's step list ("Follow the signs", "Take the elevator"); the MBTA's pathways.txt isn't drawn on the map.
- **The V3 streaming path is untested against live data** until a key is set;
  the GTFS-realtime path is what ran on live data.
- **Walking times on Now and the map are still straight-line × 1.3** (labelled "about"). The trip planner's walks use real streets.
- **Planning far ahead shows scheduled times**: live labels only exist for the next hour or so of predictions.
- **The graph needs rebuilding** (`npm run otp:build`, about 3.5 min, 5 GB of memory) when the MBTA publishes a new GTFS feed. That isn't automated yet.
- **The MassDOT Developers License** hasn't been read yet. Read it before anything goes public.

## Privacy

No account. Pinned stops, walking pace (and the learned one, if turned on), the
trip in progress and the location opt-in are stored on the device. A shared ETA
holds only a destination name, a time and a status line, in server memory. Location is read only while the page is open and visible, rounded
to about 11 m, sent to the T-Walk server for the nearby lookup, and not logged
or stored there.

## Data and attribution

Data from the MBTA under the MassDOT Developers License Agreement. T-Walk is
not affiliated with the MBTA.
