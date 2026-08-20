# Mainline roadmap

This is the single authoritative list of unfinished product and engineering
work. Detailed plan documents explain individual systems, but they do not set
priority. Completed phase documents are historical records. Update this file
whenever work ships, is deferred, or changes direction.

Last reconciled: 2026-08-19.

## Product direction

Mainline is a mobile-first opening explorer, repertoire-module builder, and
drill tool. The near-term goal is to make the existing loop—choose a module,
prepare moves, understand coverage, and drill it—clear and dependable before
adding broad new modes. Desktop must remain intentional. Public launch and
paid infrastructure are separate gates, not assumptions behind product work.

## Current sequence

### R1 — Finish and review the core workspace

1. Complete the profile/module-management simplification and validate the
   latest phone and desktop layout with the user.
2. Perform the outstanding hands-on review of A2 drill-analysis board facts.
   Treat A2 as implemented but not product-accepted until that review.
3. Fix defects found in those two reviews before broadening scope.

The visual/product reviews above require user input. Regression tests,
accessibility checks, and clearly identified defects within the accepted design
can proceed independently.

### R2 — Make coverage trustworthy and actionable

- Rank individual uncovered replies by matching-game exposure.
- Separate rare uncovered replies from the 95% practical-coverage label.
- Add minimum-sample/reliability states and explain the sample used.
- Deduplicate transposed positions while retaining module/path provenance.
- Make long calculations resumable and reuse completed position scores without
  mixing public and My Games filters.
- Test skewed samples, threshold boundaries, no-data states, rate limiting,
  transpositions, and navigation back into Explorer.

Detailed contract: [profile-modules-plan.md](profile-modules-plan.md).

### R3 — Make drill feedback actionable

- Complete comparison C1: Current/Matched viewing, exact-transposition versus
  similar-position classification, module/line provenance, and Explorer
  navigation without losing the drill.
- Complete C2 only after C1 review: compare cached board facts, prioritize the
  differences that explain the move, and suppress unsupported explanations.
- Implement parent/child Stockfish consistency rechecks using the frozen
  thresholds and loop prevention in the analysis plan.
- After the core drill loop is settled, add persisted spaced-repetition
  scheduling based on position/line outcomes rather than uniform shuffling.

Detailed contracts: [position-comparison-plan.md](position-comparison-plan.md)
and [position-analysis-plan.md](position-analysis-plan.md).

### R4 — Complete player-game workflows

- Compare indexed personal games against saved module/profile lines and surface
  the first meaningful deviation with exact move-order context.
- Add rebuild/retry/status controls for the browser game index, storage-usage
  visibility, quota/failure recovery, and a deliberate clear-local-index action.
- Add lookup of another public player/GM for repertoire research, with rate-limit
  handling and clear separation from linked personal identities.
- Decide whether Chess.com public aggregate explorer statistics are worth a
  separate integration; Chess.com personal games already participate in My
  Games and should not be conflated with this decision.

### R5 — Finish module and library workflows

- Add module/global-release start anchors: normalized FEN plus preferred legal
  move-order prefix, validation, preview, open/drill/coverage-from-start, and
  legacy fallback.
- Replace direct community publishing with a review workspace for metadata,
  start anchor, line/annotation preview, validation, changelog, confirmation,
  and immutable superseding releases.
- Add library search/filtering, publisher/release provenance, stable shareable
  release URLs, update awareness for pinned old releases, and clear copy/open
  actions.
- Add community reports, moderator hide/restore actions, audit history, and
  abuse controls before promoting discovery.
- Add Lichess-study/ChessBase-specific import only after concrete fixtures and
  annotation/licensing expectations are defined.

### R6 — Explorer and naming refinements

- Add source/filter-scoped move-frequency arrows with an overlap-safe visual
  treatment and no stale arrows during source changes.
- Keep the normalized-FEN Mainline preferred-name layer as the display override
  over Lichess classification.
- Backburner: traverse common Lichess positions and curate richer names for the
  highest-volume positions still using ancestor-plus-moves fallbacks.
- Decide whether users need personal display-name aliases; do not mix module
  names into the global position classification by accident.

### R7 — Quality, ownership, and operations

- Add account data export and deletion flows covering profiles, modules,
  publications, drill history, linked identities/tokens, and documented
  retention exceptions. This requires policy review before implementation.
- Define cache/index retention and cleanup for server caches and browser game
  indexes; expose recovery controls before storage failures become mysterious.
- Maintain phone-first accessibility and desktop regression coverage, including
  keyboard use, focus, reduced motion, contrast, zoom/reflow, and screen-reader
  names. Add a deliberate supported-browser matrix.
- Add production-safe error reporting, health/queue/cache metrics, deploy alerts,
  and privacy-aware diagnostics without logging credentials or private game data.
- Perform dependency/security review, secret/callback rotation procedures, CSP
  and security-header review, database backup/restore testing, and incident
  ownership before durable public use.
- Complete the legal/attribution/contact/feedback launch checklist in
  [deployment-plan.md](deployment-plan.md).

## Product gaps requiring decisions

- Onboarding and empty-state flow: guided first module versus an unobtrusive
  checklist, and whether a starter library module should be suggested.
- Account export/deletion policy, community-publication behavior after account
  deletion, and retention periods.
- Spaced-repetition model and what progress should attach to when a module is
  edited, copied, detached, or deleted.
- Community discovery scope, moderation expectations, publisher identity, and
  licensing of user-published modules.
- Whether personal aliases for opening names are useful or would create
  confusing inconsistency across Explorer, drills, and shared modules.
- Which browsers are supported and whether PWA/offline behavior is worthwhile.
- Whether public Chess.com aggregate statistics justify their additional API
  and presentation complexity.

## Backburner

- Curating the common unnamed-position queue.
- Intent-specific repertoire construction: build distinct aggressive/must-win
  lines and stable, drawish/must-not-lose lines. Keep these as explicit module
  intents rather than presenting either as the objectively best repertoire;
  candidate selection should combine engine soundness with transparent
  practical signals such as decisiveness, draw rate, risk, and opponent reply
  difficulty.
- A3/A4 advanced positional interpretation and plan explanations; resume only
  after A2 and C1/C2 are trusted.
- A5 subjective playability/coaching labels.
- Server-side Stockfish workers; add only if measurement shows the client/cache
  approach is inadequate.
- Play versus a configurable engine bot.
- Native apps, PWA installation, offline mode, and push notifications.
- Similar-position suggestions outside the drill-feedback use case.

## Shipped baseline

The current baseline includes the responsive Explorer, Lichess public stats,
linked Lichess and Chess.com personal-game browser indexing, client Stockfish,
personal modules and composed profiles, immutable global releases, explicit
authored lines and PGN round-tripping, selected-position drills, cached drill
analysis through A2, coverage foundations, Google sign-in, optional linked
chess identities, session/local persistence, Tailscale development access, and
a disposable Render alpha configuration. See [README.md](README.md) for the
operational summary and the focused plan documents for implementation history.
