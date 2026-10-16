Design a mobile web app called "T-Walk" for people in Boston who get around by subway, bus, commuter rail and ferry, plus walking. This round is the LIVE MAP, plus the existing "Now" screen restyled so the two match. Phone first: 390 × 844. Make every screen in both a light and a dark version.

PERSONALITY
Colourful, lively and confident, but calm enough to read at a glance while walking. Think of a transit map that comes alive: bold coloured route lines on a quiet, muted basemap, vehicles gliding along them. Rounded, friendly shapes, generous spacing, big touch targets (at least 44 × 44 px). System font (SF Pro / Roboto), bold numbers in a tabular style.

BRAND GREEN (the app's own colour)
A fresh, vivid emerald green is the signature colour: buttons, selected tabs, toggles, the "you are here" dot, focus rings, the live-status pill.
- Light theme: fill #12B76A with near-black text #04210F on it; green text on white uses #067647.
- Dark theme: fill #3DDC97 with #04210F text on it; green text uses #6CE9A6.
- Never use white text on the bright green (too little contrast).
- The brand green is for interface chrome only. It must never be used to draw a route line, so it can't be confused with the Green Line.

OFFICIAL LINE COLOURS (use exactly, for lines, route chips and vehicle markers)
Red Line #DA291C (also Mattapan), Orange Line #ED8B00, Blue Line #003DA5, Green Line #00843D (branches B, C, D, E), Silver Line #7C878E, Commuter Rail #80276C, Bus #FFC72C, Ferry #008EAA.
Route chips: pick black or white text, whichever contrasts better (black on Orange and Bus yellow).
Do NOT use the MBTA logo, the "T" roundel or any MBTA branding. T-Walk is independent.

SCREEN 1 — MAP (main view)
- Full-bleed map of downtown Boston (Park Street, Downtown Crossing, Government Center, South Station, the Common). Muted basemap (soft greys, pale water, faint street labels) so the coloured lines pop. Route lines are thick, with a thin light casing.
- Vehicles: small rounded arrow markers in their line's colour, pointing in the direction of travel, with a tiny label ("Red", "Green D", "1", "SL5"). Some show a 3-dot crowding indicator.
- Stops: small white circles with a coloured ring at stations; tiny dots for bus stops, shown only when zoomed in.
- Top: a search pill ("Search stops or places") with a round profile/settings button beside it. Under it, a scrollable row of filter chips with icons: Subway, Bus, Commuter Rail, Ferry, Bluebikes. Selected chips are filled with brand green.
- A small floating status pill: green dot + "Live · updated 4s ago".
- Right edge: floating round buttons for "Locate me" and "Layers".
- The "you are here" dot is brand green with a soft pulsing halo and an accuracy ring.
- Bottom tab bar: Now, Map (selected), Trips, Saved. The selected tab gets a brand-green pill behind its icon.

SCREEN 2 — VEHICLE SHEET (after tapping a Red Line train)
A bottom sheet at half height over the map; the train's route is highlighted and the others dim.
- Header: Red Line chip, "to Ashmont", "Train 1879", crowding "Some seats", a "Live" label with a small pulsing dot.
- A vertical timeline of its next stops with times: "Downtown Crossing · Arriving", "South Station · 3 min", "Broadway · 5 min"…, its current position marked on the timeline.
- A big brand-green button: "I'm on this train" (it will follow the train underground, where GPS fails).
- Handle bar on top; the sheet can be dragged to full height.

SCREEN 3 — STOP SHEET (after tapping Park Street)
- Header: "Park Street", "about 4 min walk · via Tremont St entrance", a star to pin it.
- Departures grouped by line and direction. Each row: destination on the left; on the right the time in bold ("Boarding", "6 min", "8:34 AM") and under it a "Can I make it?" chip:
  ✓ "You have time" (green), ⚡ "Hurry" (amber), ✕ "You'll miss it" (red). Always icon + word, never colour alone.
- Under each destination, a small source label: "● Live", "🕒 Estimate", "🕒 Scheduled". Scheduled times are always clock times ("8:34 AM"), never countdowns.
- One row shows a warning: "⚠ May not run: nothing live on this trip yet".
- Subway with no live data shows "Every 8–13 min · Scheduled".

SCREEN 4 — LIVE DATA INTERRUPTED (same map)
- An amber banner at the top: "Live data is interrupted. Vehicles are shown where they were last seen."
- Vehicle markers are greyed out with a small clock badge and "2 min ago".
- The status pill changes to amber: "Updated 2 min ago".

SCREEN 5 — "NOW" SCREEN, restyled to match
A scrolling list of nearby stops sorted by walking time. Each stop is a card: name, walk time with a walking-person icon, a star to pin, then departures in the same row design as the stop sheet. A segmented "Pace: Slow / Normal / Fast" control at the top, the same bottom tab bar (Now selected).

SCREEN 6 — LAYERS PANEL
A small sheet with switches: Vehicles, Stops, Route lines, Bluebikes stations (shows bikes/docks counts, e.g. "7 bikes · 3 docks" in a small bubble), Show crowding.

RULES
- Text meets WCAG AA contrast: 4.5:1 for normal text, 3:1 for large text and icons.
- Colour is never the only signal: every status has an icon and a word.
- Show times in a believable way: "Arriving", "Boarding", "1 min", "4 min", "8:34 AM". No seconds, no "Approaching".
- Use made-up but realistic Boston data; no real people's names.
