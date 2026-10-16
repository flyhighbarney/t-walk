# Design review, 2026-10-16

Run with the `design-taste-frontend` skill on commit 3a6bbe1 (black-and-white theme), on the `normal`
replay with the stand-in OTP, standing at Park Street. Screens: Now, Map (with and without the Park
Street sheet), Trips (list and one trip), navigation (`/go`), Saved (with the new-commute form), in
dark and light on a Pixel 7, plus Now and Trips at 1024 px.

The skill is written for marketing pages, so some of its checks don't fit an app. Those are listed
separately at the end and not counted against T-Walk.

## Verdict

A clear, honest utility. Live vs. scheduled is labelled everywhere, the colour rules hold, and
navigation (`/go`) is the strongest screen: one instruction, one map, three actions. The weak spot is
**Now**, the screen people open most: it is too loose to read at a glance. At 412 px wide, only one stop
fits on the first screen.

Indicative scores (the skill's juror scale, adapted to an app): design 7 · usability 7.5 · creativity
6.5 · content 7.5 → **7.1**.

## Findings, most visible first

1. **Now is too tall per departure.** Each departure is a card inside the stop card, about 80 px high,
   and repeats the headsign: "Harvard" three times under "Outbound to Harvard Square". At 412 px, the
   first screen holds one stop and three times. Fix: drop the headsign line when it matches the
   direction label. Make departures plain rows in the stop card (no inner card), with the status beside
   the time, not under it. That's about 48 px per row, which fits two or three stops on the first
   screen. (`components/Departures.tsx`, `StopCard.tsx`)

2. **A status chip on every row is noise.** Most rows carry a solid green "You have time", so green
   is the commonest colour on Now, and the amber "Hurry" chip has to compete with it. Fix: show only
   Hurry and You'll miss it as chips. Leave "you have time" unmarked, or give it a small green tick
   beside the time. This also keeps green to its job as the live signal.

3. **The text that carries the honesty is the smallest.** Live / Estimate / Scheduled, the status
   chips and "On time · Track 3" are 12 px (`text-xs`). Live vs. scheduled is the app's key promise,
   so these labels shouldn't be the smallest text on screen. Fix: 14 px at least. The inspector also
   flags 12 px as the most common text size on Now and Trips.

4. **Tablet leaves the header behind.** At 1024 px the content is a centred column (240–784 px), but
   the "Now" header stays at x = 16. The two left edges don't line up, and there are 240 px of empty
   ground on each side. Fix: give `AppHeader` the same `max-w-xl mx-auto` as the content. Better, at
   ≥ 900 px, put the list beside the map.

5. **The same control works differently in different places.**
   - Step-free is a switch on Trips but a checkbox in the commute form.
   - The Map's "In view" list writes its statuses with text glyphs (`✓ ⚡ ✕`,
     `screens/map/MapScreen.tsx:692`), while Now uses the SVG icons.
   - The commute form's time field shows `09:00` while the rest of the app says `8:34 AM`. This was
     headless Chromium, so check it on a phone.
   - In the day picker, "Sun" wraps onto a line of its own.

6. **Trip detail calls the end "Destination", not "Harvard Yard".** You see "Walk 4 min to
   Destination" and "Arrive at Destination 8:47 AM", although the plan was made with
   `toName=Harvard Yard`. OTP names a coordinate end point "Destination", so the same thing probably
   happens with the real planner too. Fix: use `toName` (and `fromName`) from the plan request in
   place of OTP's place names.

7. **The Map stop sheet.**
   - In dark mode, a bright 2 px white outline runs around the sheet's top edge. It reads as a
     selection.
   - There's an empty band of about 70 px between the title and the alert.
   - The mode chips (Subway / Bus / Commuter Rail / Ferry) are solid white pills over the map. They
     are the brightest thing on screen, so they compete with the vehicles and the line.

8. **The header disc.** A 40 px solid white circle with the walker sits on every tab. It is the
   brightest shape in the header and looks like a button, but it is decoration (`aria-hidden`).
   Shrink it to a small wordmark or drop it on tabs, where the tab bar already says where you are.

9. **Small copy issues.**
   - The Trips list shows a walker icon with a bare "36", then "36 min walk" on the next line.
     Show one or the other.
   - Navigation's footer reads "44 min · 4.8 mi · arrival · Scheduled". "arrival" is a dangling word.
     Try "Arrive 8:47 AM · 44 min · 4.8 mi · Scheduled", with the big 8:47 AM above it.

10. **The test fixture draws a leg in California.** In `fixtures/otp/plan.json` the one non-empty
    `legGeometry` is `_p~iF~ps|U_ulLnnqC`, Google's example polyline (38.5,-120.2 → 40.7,-120.95). So
    in e2e and replay, the trip map zooms out to the whole United States. This is not an app bug, but
    it hides real map regressions. Fix: replace it with a short Red Line shape near Park Street.

## Lint items that are fine as they are

- `edge-fade` gradient (`styles.css:145`): it's a mask that shows a row scrolls, not decoration.
- Shadows on map overlays (`MapScreen.tsx:392`, `GoMap.tsx:55`, `.shadow-float`): they really
  float over a moving map. The one exception is the "Where to?" pill on Now in light mode, which sits
  on the page and doesn't need one.
- Backdrop blur on the sticky header and the tab bar, and the tab bar's top border: platform
  convention.
- `padStart` in `Commutes.tsx:29`: it builds a clock time.
- `animate-pulse` in `GoScreen.tsx:243`: fine if it's the live dot and respects reduced motion.
- Roboto: a deliberate choice (Phase 5).

## Landing-page checks that don't apply to T-Walk

The skill also failed these. They're right for a marketing page, but wrong for this app:
- "No focal point / headline under 8vw"
- "Fewer than four real photographs"
- "No primary button on the first screen" (Trips, Saved)
- "One live thing"

If T-Walk ever gets a public landing page, that page should follow those rules.

## Not checked

- A real phone, VoiceOver/TalkBack, and long stop names on Map sheets. These are still open from the
  standup.
- Motion: the screenshots are stills.

## Outcome (same day)

All ten findings fixed (see the CLAUDE.md change log), and retaken on the same replay:
- **Now:** the first stop's departures plus the next stop's first row fit on the first screen
  (before: one stop). Times line up down the right edge.
- **Map sheet:** no white outline. The gap under the title went from about 30 to 18 px.
- **Trip detail:** the trip ends at "Harvard Yard", and its map shows Boston and Cambridge.
- **Tablet:** the header lines up with the content column.

Left as they were:
- The commute time field still shows `09:00` in headless Chromium. This is the browser's native
  control, so check it on a phone.
- The tablet still uses one column. Putting the list beside the map is a bigger change, for later.
