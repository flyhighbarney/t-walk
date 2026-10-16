# T-Walk standup log

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
