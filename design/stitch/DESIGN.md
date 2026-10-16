---
name: Urban Kinetic Transit
colors:
  surface: '#f9f9ff'
  surface-dim: '#d0daf2'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f3ff'
  surface-container: '#e8eeff'
  surface-container-high: '#dfe8ff'
  surface-container-highest: '#d9e3fb'
  on-surface: '#111c2d'
  on-surface-variant: '#3d4a3f'
  inverse-surface: '#273143'
  inverse-on-surface: '#ecf0ff'
  outline: '#6d7b6e'
  outline-variant: '#bccabc'
  surface-tint: '#006d3c'
  primary: '#006d3c'
  on-primary: '#ffffff'
  primary-container: '#12b76a'
  on-primary-container: '#004021'
  inverse-primary: '#51df8e'
  secondary: '#006d40'
  on-secondary: '#ffffff'
  secondary-container: '#98f6bb'
  on-secondary-container: '#007345'
  tertiary: '#47654e'
  on-tertiary: '#ffffff'
  tertiary-container: '#88a88d'
  on-tertiary-container: '#203d29'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#70fda7'
  primary-fixed-dim: '#51df8e'
  on-primary-fixed: '#00210e'
  on-primary-fixed-variant: '#00522c'
  secondary-fixed: '#98f6bb'
  secondary-fixed-dim: '#7cd9a1'
  on-secondary-fixed: '#002110'
  on-secondary-fixed-variant: '#00522f'
  tertiary-fixed: '#c9ebce'
  tertiary-fixed-dim: '#aecfb2'
  on-tertiary-fixed: '#04210f'
  on-tertiary-fixed-variant: '#304d38'
  background: '#f9f9ff'
  on-background: '#111c2d'
  surface-variant: '#d9e3fb'
typography:
  headline-lg:
    fontFamily: Roboto Flex
    fontSize: 32px
    fontWeight: '800'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Roboto Flex
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 30px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Roboto Flex
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 26px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Roboto Flex
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-md:
    fontFamily: Roboto Flex
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  body-sm:
    fontFamily: Roboto Flex
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  time-display-lg:
    fontFamily: Roboto Flex
    fontSize: 28px
    fontWeight: '800'
    lineHeight: 32px
    letterSpacing: -0.02em
  time-display-md:
    fontFamily: Roboto Flex
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 24px
    letterSpacing: 0em
  label-lg:
    fontFamily: Roboto Flex
    fontSize: 14px
    fontWeight: '700'
    lineHeight: 18px
    letterSpacing: 0.02em
  label-md:
    fontFamily: Roboto Flex
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.03em
  label-sm:
    fontFamily: Roboto Flex
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 0.75rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

The design system is crafted for high-stress, on-the-move decision making on dense urban streets. It balances a lively, energetic civic personality with absolute clarity and calm utility. The primary user is walking while looking down at a phone screen (standard 390x844 viewport), navigating Boston's transit network under varying sunlight, speed, and cognitive load.

The visual style pairs modern rounded ergonomics with high-contrast, information-dense utility. Interfaces avoid visual clutter and ornamental skeuomorphism, prioritizing glanceability, generous target hit zones, and immediate legibility of time, pace, and live transit arrivals.

### Tone and Principles
- **Glanceable Over Decorative:** Critical transit information must be decipherable in under 500 milliseconds.
- **Civic Legibility:** Strict respect for established public transit palettes, distinctly separated from functional interface chrome.
- **Physical Confidence:** Tactile, rounded components and bold tabular typography create clear touch confidence on the move.

## Colors

The color system enforces a clear semantic division between interface chrome (navigation, primary actions, pacing status) and official MBTA line branding. 

### Interface Brand Palette
- **Primary Brand Green:** `#12B76A` (Dark mode: `#3DDC97`). Used solely for key navigational chrome, primary confirmation actions, and brand accents. **Never use brand green for route lines.**
- **Brand Ink / Text on Green:** `#04210F`. **Strict Rule:** White text on `#12B76A` or `#3DDC97` is strictly forbidden due to contrast thresholds. All text placed inside bright green fills must use `#04210F`.
- **Text Link / Accent Green on Light Surfaces:** `#067647` (Dark mode: `#6CE9A6`).

### Official MBTA Transit Network Tokens
Transit badges, route markers, and transfer indicators must strictly match official network hues and specific text contrasts:
- **Red Line:** `#DA291C` (White text `#FFFFFF`)
- **Orange Line:** `#ED8B00` (Black text `#000000`)
- **Blue Line:** `#003DA5` (White text `#FFFFFF`)
- **Green Line (B, C, D, E):** `#00843D` (White text `#FFFFFF`)
- **Silver Line:** `#7C878E` (White text `#FFFFFF`)
- **Commuter Rail:** `#80276C` (White text `#FFFFFF`)
- **Bus:** `#FFC72C` (Black text `#000000`)
- **Ferry:** `#008EAA` (White text `#FFFFFF`)

### "Can I Make It?" Pacing States
Pacing states communicate walking feasibility. They must always couple color tinting with structured icons and text labels:
- **Feasible / "You have time":** Tint background `#ECFDF3`, Border `#A6F4C5`, Text & Icon `#067647`. Dark mode: Tint background `#053321`, Text `#6CE9A6`.
- **Urgent / "Hurry":** Tint background `#FFFAEB`, Border `#FEDF89`, Text & Icon `#B54708`. Warning Accent `#F79009`. Dark mode: Tint background `#4E1D09`, Text `#FEC84B`.
- **Missed / "You'll miss it":** Tint background `#FEF3F2`, Border `#FECDCA`, Text & Icon `#B42318`. Critical Accent `#F04438`. Dark mode: Tint background `#55160C`, Text `#FDA29B`.

### Live Data Feeds
- **Live / Realtime (GPS):** `#12B76A` pulsing indicator with `#04210F` or `#067647` label.
- **Estimate (Algorithm):** Neutral slate `#667085`.
- **Scheduled (Timetable):** Neutral slate `#98A2B3` formatted as clock time (e.g., "8:34 AM").

## Typography

The type hierarchy prioritizes split-second recognition while walking outdoors. All typography employs system-grade variable sans-serif metrics (`Roboto Flex` on web/Android and fallback `-apple-system, BlinkMacSystemFont, "SF Pro"` on iOS). 

### Tabular Numbers & Dynamic Timers
All countdown clocks, walking distances, and departure countdowns must activate `font-variant-numeric: tabular-nums` (monospaced numbers). This prevents layout jitter during real-time seconds ticking and ensures strict column alignment across transit list items.

### Hierarchy & Mobile Readability
- **Time Display Roles (`time-display-lg`, `time-display-md`):** Reserved for remaining walking minutes and arrival times (e.g., "4 min", "12:42 PM").
- **Headline Roles:** Kept compact (capped at 32px) to optimize the 390px mobile viewport, preventing line wrapping on longer Boston station names (e.g., "JFK/UMass", "Government Center").
- **Labels:** Distinct, semi-bold to bold letterforms with slight positive tracking for all-caps transit tokens and vehicle badges.

## Layout & Spacing

Designed fundamentally around the 390x844 mobile phone viewport. The layout relies on a single-column fluid card deck overlaying a persistent background map sheet.

### Spacing & Grid Metrics
- **Canvas Margins:** 16px (`1rem`) on outer screen edges to maximize card width on mobile while avoiding thumb bezel occlusion.
- **Card Padding:** Internal card padding is consistently 12px to 16px to maintain high data density without crowding.
- **Grid Gutter:** 12px (`0.75rem`) separation between stacked transit cards and horizontal carousels.

### Physical Touch Target Standard
Every interactive control—including step buttons, line filters, modal dismissals, and quick-save toggles—must enforce a strict **minimum boundary box of 44x44px**. Visual element icons may be smaller (e.g., 20px), but their touchable padding must expand to 44px minimum to ensure error-free activation while striding.

## Elevation & Depth

Visual depth is conveyed through tactile surface layering combined with ambient ground shadows. This provides a clear spatial metaphor: the map sits at base level, transit cards sit in the interaction tier, and live status floating controls sit on the top tier.

### Elevation Hierarchy
- **Base Level (Map / Underlay):** Canvas flat layer.
- **Tier 1 (Surface Cards & Docked Sheets):** Surface `#FFFFFF` (Dark: `#161B22`) with low-contrast structural outline `1px solid rgba(0, 0, 0, 0.08)` and subtle ambient shadow: `0 4px 16px -2px rgba(16, 24, 40, 0.08)`.
- **Tier 2 (Floating Action Buttons & "Can I Make It?" Floating Banners):** Surface `#FFFFFF` with `0 12px 24px -4px rgba(16, 24, 40, 0.16)` and 1px border.
- **Tier 3 (Modals & Emergency Station Alerts):** Modal sheet resting above dark scrim `rgba(10, 13, 18, 0.6)`.

Avoid blurry heavy glassmorphism on card bodies; outdoor daylight legibility demands solid, opaque white or dark surfaces with crisp borders.

## Shapes

The design system employs a soft, approachable, rounded aesthetic (Level 2). Rounded contours soften the industrial nature of municipal transit information while creating clear visual separation between stacked card elements.

### Corner Radii Guidelines
- **Transit Card Containers:** 16px (`rounded-lg`) for primary station and route cards.
- **Buttons & Input Bars:** 12px to 16px for comfortable thumb engagement.
- **Transit Line Badges (T Badges, Bus Pills):** 6px to 8px for standard branch boxes; fully rounded pills (`9999px`) for branch identifiers (e.g., "B", "C", "D", "E") and "Can I make it?" status tags.
- **Bottom Sheet Drawers:** 24px (`rounded-xl`) on top-left and top-right corners; 0px on bottom edges.

## Components

### Buttons
- **Primary Action (Brand Green):** 48px minimum height. Background `#12B76A`, text `#04210F` (`font-weight: 700`). Never white text. Active pressed state shifts background to `#0E9F5D`.
- **Secondary / Action Ghost:** Border `1.5px solid #D0D5DD`, background transparent or `#FFFFFF`, text `#344054`.
- **Transit Line Shortcut Buttons:** Rounded pill or square badge with official MBTA fill and contrast-compliant text.

### Chips & "Can I Make It?" Indicators
- Status indicators must always contain an icon and textual verdict:
  - **Safe Pace:** `✓ You have time` (Green `#ECFDF3` container, `#067647` content).
  - **Urgent Pace:** `⚡ Hurry` (Amber `#FFFAEB` container, `#B54708` content).
  - **Unreachable:** `✕ You'll miss it` (Red `#FEF3F2` container, `#B42318` content).
- Minimum chip height: 28px, padding: 4px 10px, radius: 9999px.

### Live Departure Lists
- Stacked rows separated by subtle dividers (`rgba(0, 0, 0, 0.06)`).
- Left: MBTA Line badge (e.g., Red Line circle or "66" Bus pill) paired with destination headsign (e.g., "Alewife").
- Right: Large tabular countdown (e.g., "3 min") stacked above the live indicator icon (`● Live` in green, `🕒 Estimate` in grey, or scheduled clock time `🕒 8:34 AM`).

### Input Fields & Station Search
- Height: 52px (optimized for thumb reach).
- Background `#F2F4F7`, border `1px solid transparent`, focusing to `2px solid #12B76A`.
- Prefix icon: Search or Walk icon (20px). Clear button: 44x44px hit-box with centered circular close glyph.

### Cards
- **Next Departure Card:** Houses real-time countdown, transfer route, walking distance (e.g., "320 ft • 2 min walk"), and the live pacing chip. Cards feature a 4px left-hand border accent tinted with the active MBTA line color.