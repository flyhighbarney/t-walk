# UI/UX audit, start of Phase 5 (2026-10-16)

Walked at phone size (375×812, dark) on the live build at http://127.0.0.1:8787, with real MBTA data at 2:40 AM Boston time (subway closed, buses and owl service only). The goal was to work like Apple Maps / Google Maps for transit and walking.

| # | Location | State or flow | Rule broken | Fix | Evidence | Severity |
|---|---|---|---|---|---|---|
| 1 | Server, `live/gtfsrt.ts` `feedTimestamp` | Map, every state | Status always visible (and truthful) | The MBTA vehicle feed puts `entity` before `header`, so the first vehicle's own timestamp was read as the feed's. Healthy data showed "updated 2 min ago", then "Live data is interrupted". Read the header wherever it is. **Fixed.** | `/api/health` → vehicles `stale 177s` while the feed header was 0 s old | HIGH |
| 2 | Map, any sheet | Back after opening a stop or vehicle | The browser is part of the flow | Back left the Map for Now instead of closing the sheet. Write sheets to the URL (`?stop=`, `?vehicle=`, `?bike=`, `?sheet=`) and make Back close them, like Google Maps on Android. | Opened Park Street, `history.back()` → `/` | HIGH |
| 3 | Trips | Refresh, Back, share a plan | The browser is part of the flow | From, to and time weren't in the URL: refresh lost the plan, and a plan couldn't be linked. Write them to the URL and restore them from it. | `TripsScreen.tsx:40-49` keeps them in state only | HIGH |
| 4 | Trips → chosen option | Primary flow end | Flows complete | After choosing a route there was no **Start**: no follow-me map, next instruction, ETA or "Get off next". That's the core of Apple/Google Maps. Build navigation mode. | No control after the leg list | HIGH |
| 5 | Map | Loading | State inventory: Loading | 5–10 s of black canvas with only "Connecting…". Show a placeholder on the theme's map colour with "Loading map…". | First screenshot: black map, controls only | MEDIUM |
| 6 | Map search | "Park" | Consistency (platform convention) | Hyde Park ranked above Park Street. Rank names that start with the query first, then names with a word that does. **Fixed.** | Results: Hyde Park, Park Street, Mission Park… | MEDIUM |
| 7 | Map, stations | Tap a station | Hit areas ≥ 24 px (44 on touch) | Station rings are 7 px at zoom 14; a tap beside Park Street opened nothing. Add an invisible 22 px hit layer. | Tap at Park Street label → no sheet | MEDIUM |
| 8 | Now | First screen | Status / primary action first | The walking-pace picker was the first thing on screen, and there was no "Where to?". Put a "Where to?" search first, as both map apps do. Pace moves below the stops. | Page text starts "Your walking pace" | MEDIUM |
| 9 | Trips, location off | From field | Prevent errors | From said "My location" while location was off ("Location is off… choose a place instead"). Leave From empty when location isn't available. | Page text: FROM My location / "Location is off" | MEDIUM |
| 10 | Map status | Live chip | Consistency | Two chips: "Live · updated 27 s ago" next to "updates every 10 s". Merge them into one. | Screenshot | LOW |

**Verdict at the audit:** Block (four HIGH).

**After the Phase 5 fixes:** all ten fixed. #1–#4 have tests (`tests/phase4.test.ts` for the feed timestamp; `e2e/phase5.spec.ts` for Back on Map and Trips, refresh, Start and navigation). Re-walk of #5–#10 found the real cause of #7: every layer had its own click handler, so one tap opened up to three sheets, and the last one, often the switched-off Bluebikes layer's, won and drew nothing. Taps now go to one handler that picks the top-most target (vehicle, then station or stop, then dock), covered by `e2e/phase5.spec.ts`. The map controls now hide while a sheet is open, since they overlapped its top. #6, #8, #9 and #10 were checked in the browser. #5 (the loading placeholder) is in the code, but the tiles were cached, so it couldn't be seen.

**Not verified:**
- Overflow with very long stop names on the Map sheets.
- A screen reader pass (axe runs in e2e on Now, Map and Trips).
- Real-device touch and compass.
- Offline was not re-walked; the Phase 4 e2e covers it.
