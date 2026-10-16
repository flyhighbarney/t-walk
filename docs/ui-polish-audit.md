# UI polish audit (2026-10-16)

Visual finish across Now, Map (and its sheets), Trips (and trip detail), navigation (`/go`), Share and Saved. Walked at 400 px wide in dark and light mode on the live build, then fixed.

| Severity | Location | Before | After | Why | Evidence |
|---|---|---|---|---|---|
| HIGH | `styles.css` tokens; bare `text-warn-fg` / `text-miss-fg` in `TripParts.tsx:180`, `Departures.tsx:143,187,206`, `OtherSheets.tsx:70,133,134`, `StopSearch.tsx:50`, `NowScreen.tsx`, `Commutes.tsx` | Chip-only colours used as bare text: "4 min late" was dark brown on navy | New `--warn-text` / `--miss-text` that flip with the theme; chips keep the `-fg` / `-bg` pairs | Contrast: unreadable in dark mode | Measured 1.41:1 before. After: 8.9–10.6:1 dark, 6.7–8.3:1 light |
| MEDIUM | 16 labels and headings (`PlaceField`, `TripsScreen`, `Commutes`, `NowScreen`, `SavedScreen`, `OtherSheets`, `MapScreen` status chip, `ShareScreen`, `TripParts` tag) | `uppercase` + `tracking-widest` eyebrows everywhere | Sentence case. Field labels 14 px semibold; section headings 18 px bold; "Fastest" as a quiet badge | Typography: hierarchy by size and weight, not capitals | `grep uppercase` → 16 before, 0 after |
| MEDIUM | `SavedScreen` / `PaceSection.tsx` | Two section headings as eyebrows above cards, the third as a title inside its card | All three are the same heading, above their card | Consistency | Saved screenshot |
| MEDIUM | `map/OtherSheets.tsx` StopSheet, `StopCard.tsx` | The pin star alone on its own row under the line chips, with an empty band above the departures | Pin is a header action beside Close (`BottomSheet` `actions`) | Alignment, wasted space | Light-mode Park Street sheet, before and after |
| MEDIUM | `trips/TripParts.tsx` walk legs | "64 m", while navigation said "550 ft" | One `formatDistance` in core (feet up to 0.1 mi, then miles), used by both | Consistency of units | Trip detail screenshot |
| MEDIUM | `FilterChip` (40 px), search and place clear buttons (40 px) | Smaller than every other control | 44 px | Hit areas: 44 on touch, same as the rest | Class census: `min-h-10`, `size-10` |
| LOW | `TripParts.tsx:90`, `TripsScreen.tsx:200` | `9:53 AM → 10:06 AM` | `9:53 AM – 10:06 AM` | Typography: a time range takes an en dash | Rendered text |
| LOW | Sort chips (Trips), line chips (stop sheet), mode chips (Map) | Rows cut off at the screen edge mid-word ("Mos") | Fade at the right edge (`.edge-fade`), so it reads as scrollable | Truncation keeps a cue | Trips screenshot |
| LOW | `trips/TripMap.tsx`, `go/GoMap.tsx` | MapLibre attribution opened full width over the small trip map | Starts folded to its (i) button | Spend space on the map | Trip detail screenshot |
| LOW | `go/GoScreen.tsx` | "Use compass" shown on desktop browsers that expose the permission API | Only on touch devices | Don't offer a control that does nothing | Desktop screenshot of `/go` |

Found while checking, and fixed: the map tap e2e test depended on whether the replay's train was standing on Park Street. One tap opens one thing, and the vehicle's icon is on top, so the test now checks both: the train when it's there, the station when vehicles are hidden.

**Verdict:** Approve. No HIGH left.

**Not changed, by choice:**
- **Nested radii.** Departure tiles and alert boxes use 12 px corners inside 16 px cards with 16 px padding. The strict concentric formula gives 0 px (square tiles), which would change the product's look from the Stitch design. That's a design decision for you, not a polish fix.
- **Mode chips on the map are all filled green when on.** It's loud, but it's the Stitch design's choice.

**Not verified:**
- Hover and focus-visible styling driven by real Tab presses. The pane's window was hidden for part of the walk; axe passes in e2e.
- Zoom at 200%.
- The Saved commute form after the label change. Text and types were checked; the screenshot timed out.
