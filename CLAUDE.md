# T-Walk: project notes for Claude

Live MBTA departures by walking time. npm workspaces: `packages/core`, `apps/server`, `apps/web`. Node >= 24.

## Commands
- `npm test` (vitest), `npm run typecheck`, `npm run lint`, `npm run test:e2e` (builds, then Playwright).
- `npm run dev` runs server and web. See README.md for OTP setup and architecture.

## Status
Phases 1-5 done (see README.md). Phase 6 next: trip history, transfer-risk from real history.

## Change log (newest first)
- 2026-10-16 (hourly run): Verified Phase 5. typecheck clean, 177 unit tests and 22 e2e tests pass. Fixed all lint warnings (`nav.ts` uses `startsWith`; `share/routes.ts` strips control chars with `\p{Cc}`). Added this file and `project standup meeting.md`.
