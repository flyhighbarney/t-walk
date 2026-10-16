# T-Walk: project notes for Claude

Live MBTA departures by walking time. npm workspaces: `packages/core`, `apps/server`, `apps/web`. Node >= 24.

## Commands
- `npm test` (vitest), `npm run typecheck`, `npm run lint`, `npm run test:e2e` (builds, then Playwright).
- `npm run dev` runs server and web. See README.md for OTP setup and architecture.

## Status
Phases 1-5 done (see README.md). Phase 6 in progress: core history model done; server recording, persistence and planner wiring still to do.

## Change log (newest first)
- 2026-10-16 (hourly run 2): Verified last commit (typecheck, lint, e2e all clean). Phase 6 slice 1: `packages/core/src/history.ts` (`ArrivalHistory`: per route+stop delay samples, p80 clamped 0-5 min, needs 8+ samples, JSON round-trip). `transferRisk` takes an optional third arg `historyBuffer(legIndex)` that widens the arriving ride's buffer. Not wired to the server yet, so app behaviour is unchanged. 183 unit and 23 e2e tests pass.
- 2026-10-16 (hourly run): Verified Phase 5. typecheck clean, 177 unit tests and 22 e2e tests pass. Fixed all lint warnings (`nav.ts` uses `startsWith`; `share/routes.ts` strips control chars with `\p{Cc}`). Added this file and `project standup meeting.md`.
- 2026-10-16: UI polish audit (`docs/ui-polish-audit.md`). Warning/error text tokens that read in dark mode (`--warn-text`, `--miss-text`; was 1.41:1). Sentence case instead of uppercase eyebrows. Stop-sheet pin in the header. Feet/miles everywhere (`formatDistance` in core). 44 px chips. Edge fade on sideways rows. Map tap e2e covers vehicle-over-station. 177 unit and 23 e2e tests pass; Lighthouse Now 97/100/100.
