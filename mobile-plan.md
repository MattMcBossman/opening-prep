# Mobile-first experience plan

The future end-of-drill coaching expansion is specified separately in
[position-analysis-plan.md](position-analysis-plan.md), including phone-safe
engine budgets, progressive disclosure, and stable completion actions.

## Status and objective

**This is the next active project milestone.** Private phone access through the
laptop-hosted Tailscale route is in place, so the next work is making Explorer,
repertoire authoring, and drills genuinely comfortable on a phone.

Progress: **M1–M4 engineering is complete and M5 automated verification is
complete.** The board-first fluid layout has
been visually checked at 390px and automatically verified at 320×700, 390×844,
430×932, and 667×375 with no document overflow and a square board. Mobile
Moves/Stats/Prep navigation is also shipped with state-preserving tabs. Core
Explorer rows, filters, source controls, repertoire actions, and PGN controls
now meet the 44px mobile touch-target baseline. Explorer/view context also
survives tab refreshes through `sessionStorage`, and long profile/module names
remain contained without displacing the Manage action. The only remaining acceptance
item is a hands-on pass on the physical Android phone over Tailscale; it cannot
be truthfully simulated from the development workstation.

The target is a high-quality responsive web application, not a separate native
app. Desktop behavior must remain intact. PWA installation/offline support is a
later decision after the touch-first web experience is proven.

Mobile board sizing uses near-edge 2px page gutters (while retaining device
safe-area insets) and a compact 36px evaluation bar, leaving at least the
viewport width minus 45px for the square board at the verified phone sizes.

## Resolved baseline findings

The initial audit found the following constraints; all are now resolved by the
M1–M5 work below:

- `.board-column` is fixed at 630px;
- `.explorer-panel` has a 420px minimum width;
- `.moves-panel` is fixed at 220px and precedes the board in document order;
- Explorer and Drill layouts wrap desktop columns rather than defining a phone
  information hierarchy;
- header controls, filters, tables, profile management, and board controls can
  create dense or undersized touch targets;
- there was no automated mobile viewport coverage.

The result must be designed around the board and the next likely action, not
merely scaled-down desktop columns.

## Mobile information architecture

On viewports below the final measured breakpoint (start with 700px):

1. Keep a compact top bar with product identity, Explorer/Drills mode, and an
   overflow/settings control. Theme, sound, authentication, and profile
   management must remain reachable without consuming several header rows.
2. Put opening name, drill progress, and the White/Black orientation control
   immediately above the board.
3. Make the board the first primary workspace, sized from available viewport
   width while reserving the narrow evaluation bar without horizontal scroll.
4. Put the board's primary actions directly below it with at least 44×44 CSS-px
   touch targets and clear disabled/pressed states.
5. Present secondary Explorer content as explicit mobile sections/tabs:
   **Moves**, **Stats**, and **Prep**. Preserve state when switching sections.
   “Prep” contains profiles/modules, coverage, and PGN tools rather than placing
   all of them in one long undifferentiated column.
6. In Drills, show feedback directly below the board. During completed-line
   review, keep **Next/Finish** and **View in explorer** easy to reach; returning
   from Explorer must continue preserving the drill session.

Desktop can retain its multi-column presentation. Component semantics and data
state should be shared rather than maintaining separate desktop/mobile apps.

## Implementation sequence

### M1 — Baseline and layout foundation

- [x] Add reusable viewport/layout rules for page gutters, board/eval sizing,
  touch targets, and safe-area insets.
- [x] Replace fixed primary widths/min-widths with bounded fluid sizing. At
  320px CSS width there must be no document-level horizontal scrolling.
- [x] Give Explorer and Drill explicit responsive layout order so mobile document
  order is board first and desktop order remains intentional.
- [x] Verify board resizing never distorts the square, clips coordinates, or
  causes a resize jump when the drill evaluation bar appears.
- [x] Respect `prefers-reduced-motion` for nonessential transitions while
  retaining understandable chess move feedback.

Exit gate: the shell, header, board, and primary actions fit at widths 320, 360,
390, and 430px in portrait and at 667×375 landscape without horizontal scroll.

### M2 — Mobile navigation and Explorer

- [x] Build the compact mobile header/overflow treatment without hiding current
  authentication, sound, theme, profile, color, or mode capabilities.
- [x] Add accessible Moves/Stats/Prep section navigation on phones. Keep the
  selected section when positions update and use real buttons/tabs with focus
  and selected-state semantics.
- [x] Make move rows, save/remove controls, explorer rows, source toggle,
  month/year selectors, rating bands, and speed filters comfortably tappable.
- [x] Make the statistics table readable without page-level overflow. Prefer
  responsive columns/labels; use a contained table scroller only where the data
  cannot be simplified honestly.
- [x] Ensure loading, partial-indexing, retry, rate-limit, and error messages do
  not cause layout shifts or cover primary actions.
- [x] Preserve separate public/My Games filters and clear stale-source visuals
  through every mobile section switch.

Exit gate: a phone user can explore a line, navigate history, change data source
and filters, save/remove preparation, and understand loading/error states using
touch alone.

### M3 — Repertoire and management flows

- [x] Convert profile/module management into a mobile-safe sheet or full-screen
  dialog with a visible close action, scroll containment, safe-area padding,
  and focus management.
- [x] Replace prompt-dependent critical management actions where necessary with
  labeled forms that work with mobile keyboards and validation messages.
- [x] Make module membership, ordering, editing-target selection, global
  preview/pin/copy/gap-fill, coverage, and PGN import/export usable without tiny
  adjacent buttons.
- [x] Confirm destructive actions remain deliberate and labels/provenance do not
  disappear merely to save space.

Exit gate: profiles and modules can be created, composed, reordered, previewed,
and edited from a 360px phone without desktop intervention.

### M4 — Drill-first mobile experience

- [x] Tune drill board/progress/feedback order for one-handed portrait use and a
  compact board-plus-feedback landscape layout where space permits.
- [x] Keep wrong-move explanations, hints, engine continuation, review stats,
  and completion actions readable without covering the board.
- [x] Preserve the existing drag/tap, promotion, orientation, audio-unlock, and
  delayed-autoplay code paths under the responsive layout; automated drill
  logic and browser regression suites cover these shared behaviors.
- [x] Keep the active drill mounted across Explorer round trips and cover “View
  in explorer” plus return-to-session behavior in a mobile browser test.

Exit gate: a complete White and Black drill session—including mistakes, review,
Explorer handoff, return, retry, and finish—works comfortably in portrait.

### M5 — Verification, accessibility, and performance

- [x] Add Playwright projects for representative Android Chrome and iPhone
  Safari-sized viewports, including 320px minimum-width coverage and landscape.
- [x] Add assertions for no document overflow, visible primary actions, mobile
  section persistence, profile-dialog operation, and drill/Explorer continuity.
- [x] Add visible focus treatment and automated checks for labels, dialog focus
  containment/restoration, screen-reader names, and reduced motion. Reflow at
  the 320px minimum provides the equivalent narrow-width/zoom layout gate;
  physical-browser contrast and 200% zoom remain in the device smoke matrix.
- [ ] Test on the actual Android phone over Tailscale using touch, cellular, and
  both portrait/landscape orientations. Record screenshots and defects in this
  document while the milestone is active.
- [x] Review initial load, Stockfish worker startup, position interaction, and
  long-list responsiveness on the phone. Avoid premature optimization, but fix
  blocking main-thread work and accidental duplicate requests.
- [x] Run the complete frontend and PostgreSQL suites after mobile integration.

### Physical Android acceptance matrix

This is the sole remaining external acceptance pass. On the Tailscale-served
site, verify portrait and landscape: Explorer drag and tap moves near every
edge, promotion, White/Black orientation, sound unlock, delayed drill autoplay,
wrong-move review, View in explorer and return, profile-sheet keyboard behavior,
200% zoom, cellular reachability, and public/My Games loading/error states.
Record any device-specific defect here. No workstation test may mark this item
complete on the phone's behalf.

Exit gate: automated mobile checks pass, the real-phone smoke matrix passes,
desktop regression checks pass, and no critical/major mobile usability defect
remains.

## Explicitly deferred

- Native iOS/Android applications.
- PWA installation, offline caching, push notifications, and app-store work.
- Production cloud hosting and public multi-user launch.
- A visual redesign unrelated to mobile usability.
- PostgreSQL backup/restore engineering.

These can be reconsidered after the responsive web application is proven on the
developer's real phone.
