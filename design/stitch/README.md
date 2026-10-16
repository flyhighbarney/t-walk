# Stitch designs

From the Stitch project "T-Walk Boston Transit App" (fetched 2026-10-16 with
the Stitch MCP API). Each screen is here as the exported HTML and a PNG.

| File | Screen |
|---|---|
| `now-nearby-departures-light` | Now: pace picker, nearby stop cards |
| `stop-sheet-park-street-light` (+ `-modern-sans`) | Stop sheet: line filter chips, departure rows, catch chips |
| `vehicle-sheet-red-line-light` | Vehicle sheet: next-stops timeline |
| `live-data-interrupted-light` | Map with the "data interrupted" banner, stale vehicles |
| `layers-panel-light` | Layers panel |
| `DESIGN.md` | The project's design system ("Urban Kinetic Transit") |

The main **Map** screen was shared as HTML in chat on 2026-10-16 (search pill,
live pill, mode chips, locate / 3D / layers / zoom, ringed station hubs,
Bluebikes pills, a 4-minute walk circle, and the nearest-station card). Its dark
palette is what `apps/web/src/styles.css` uses.

Despite the "(Light)" titles, the screens are drawn in the dark theme.

## Where the app departs from the designs, on purpose

Accuracy rules win over the mockups:

- No vehicle speeds ("28 mph · Rolling"): subway vehicles don't report speed.
- No "Doors open right", "Platform 1 · Center Island", "Next platform clearance":
  there is no source for them.
- No "Due" and no "Approaching": the MBTA's display rules say "Boarding",
  "Arriving" or a countdown.
- No "3.1 mph calibrated": personal walking pace is learned in Phase 5; the pace
  picker shows the fixed paces as "about 2.8 mph".
- No "Auto-refreshing every 15s": live data streams; the status pill shows its age.
- No "MBTA live feed" branding; the pill just says "Live".
- No coordinates readout, voice search, Trips tab, "Guide", "Start walk", or
  "I'm on this train" yet: they need features from later phases (trip planner,
  trip companion). Elevator status needs alerts, so an API key.
- Fonts: system font instead of Roboto Flex, and inline SVG icons instead of
  Material Symbols, to keep the first load small.
