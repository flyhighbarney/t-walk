# T-Walk standup log

## 2026-10-16 (hourly run 9)
- **Verified:** commit ac90ed3: typecheck, lint, 193 unit and 23 e2e pass.
- **Done:** README now documents `GET /api/history/summary`. Docs only.
- **Next:** no phase planned. Candidates: screen reader pass, check recorded delays after days of live running.
- **Not verified:** history with real MBTA data, screen reader pass, real-device touch/compass, long stop names on Map sheets.

## 2026-10-16 (hourly run 8)
- **Verified:** commit 45d909b: typecheck, lint, 192 unit and 23 e2e pass.
- **Done:** HTTP test for `/api/history/summary` (counts with history, 404 without).
- **After:** 193 unit and 23 e2e pass, typecheck and lint clean.
- **Next:** no phase planned. Candidates: screen reader pass, check recorded delays after days of live running.
- **Not verified:** history with real MBTA data, screen reader pass, real-device touch/compass, long stop names on Map sheets.

## 2026-10-16 (hourly run 7)
- **Verified:** on d5d98bc, typecheck, lint, 191 unit and 23 e2e pass.
- **Done:** debug count of history samples: `ArrivalHistory.summary()` and `GET /api/history/summary` returning pairs, samples and usable pairs (8+ samples). Wired in `main.ts`. New unit test.
- **After:** 192 unit and 23 e2e pass, typecheck and lint clean. The route itself has no HTTP test (the test helper's `buildApp` doesn't pass history).
- **Next:** no phase planned. Candidates: HTTP test for the summary route, screen reader pass, check recorded delays after days of live running.
- **Not verified:** history with real MBTA data, screen reader pass, real-device touch/compass, long stop names on Map sheets.

## 2026-10-16 (hourly run 6)
- **Verified:** the uncommitted run 4/5 edits (Manrope/Newsreader/JetBrains Mono type, flat radii, dark-mode switch knob fix): typecheck, lint, 190 unit and 23 e2e pass.
- **Done:** Phase 6 finished. `TransferCheck.usuallyLateS`; transfer text says "the ride before usually runs N min late" once history widens the buffer; the trip risk note stops saying "no history yet" in that case; README updated; new test. `data-fixture/` gitignored.
- **After:** 191 unit and 23 e2e pass, typecheck and lint clean.
- **Next:** no phase left in the plan. Candidates: a debug count of history samples, a live multi-day check of recorded delays, screen reader pass.
- **Not verified:** history with real MBTA data (needs days of live running), screen reader pass, real-device touch/compass, long stop names on Map sheets.

## 2026-10-16 (hourly run 3)
- **Verified:** typecheck, lint, 184 unit tests clean on the uncommitted design-review work before touching anything.
- **Done:** Phase 6 slice 2. `DelayRecorder` turns live prediction changes into arrival-delay samples, saved to `data/history.json`; `Planner` and `mapItinerary` pass history into `transferRisk`. 6 new tests.
- **After:** 190 unit and 23 e2e pass. One e2e run failed 2 trips tests (autocomplete option missing); both passed on rerun and in two full runs. Treat as a flake, watch it.
- **Next:** show "usually runs N min late" in the transfer text, update the README line saying there is no history, and expose a count of samples for debugging.
- **Not verified:** history with real MBTA data (needs a live run for days), screen reader pass, real-device touch/compass, long stop names on Map sheets.

## 2026-10-16 (hourly run 2)
- **Verified:** on 9614949, typecheck, lint, 177 unit tests and 23 e2e tests all passed. After changes: 183 unit and 23 e2e pass.
- **Done:** Phase 6 slice 1. Core `ArrivalHistory` (`history.ts`) plus optional `historyBuffer` arg in `transferRisk`, with 6 new tests. No app behaviour change yet.
- **Next:** server records observed vs. shown arrival delays from the live store, persists them, passes `extraBufferS` into `mapItinerary`/`Planner`; then update the README line saying there is no history, and show "usually runs N min late" in the transfer text.
- **Not verified:** screen reader pass, real-device touch/compass, long stop names on Map sheets. Real-data behaviour of history (nothing feeds it yet).

## 2026-10-16 (hourly run)
- **Verified:** typecheck, lint, 177 unit tests, 22 e2e tests (incl. axe) all pass on commit 159a0b2.
- **Done:** lint warnings cleaned (nav.ts, share/routes.ts). Docs created.
- **Next:** Phase 6, record trip/arrival history so transfer risk uses real data (README notes there is none yet).
- **Not verified:** screen reader pass, real-device touch/compass, long stop names on Map sheets.
