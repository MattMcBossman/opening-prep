# Composable profiles, opening modules, and selected-position drills

## Live progress

Last updated: 2026-08-10

Current acceptance milestone: complete the physical Android/Tailscale smoke
matrix in [mobile-plan.md](mobile-plan.md). Mobile engineering and automated
verification are complete. Managed production deployment remains deferred until
the project is ready for independent uptime or external users.

A basic cached end-of-drill analysis is an approved near-term follow-up, with
advanced coaching split into later return phases. See
[position-analysis-plan.md](position-analysis-plan.md).

Mobile progress: M1–M4 engineering and the M5 automated verification pass are
complete. The app now has a board-first fluid shell, compact settings header,
Moves/Stats/Prep navigation, responsive statistics, 44px touch targets, a
full-screen accessible repertoire manager, drill-first portrait/landscape
layouts, and drill/Explorer session continuity. Automated coverage spans
320–430px portrait, 667×375 landscape, Android Chrome emulation, and
iPhone-sized touch emulation. The remaining acceptance item is the documented
hands-on Android/Tailscale smoke matrix in `mobile-plan.md`.

Mobile profile management (M3) is complete: Manage opens as a contained desktop
dialog and a safe-area-aware full-screen phone sheet, traps focus, closes with
Escape or its visible close control, restores focus and page scrolling on exit,
and presents profile/module creation and renaming as labeled validated forms
instead of browser prompts. At 360px, module membership and ordering, explicit
editing-target selection, immutable-global provenance, preview/pin/copy/gap
fill, and deliberate destructive confirmations remain fully available through
touch-sized controls.

Current repair note: browser-authored line saving was rejected because
`chess.js` and python-chess used different en-passant FEN emission modes after
double pawn moves. The backend now validates with legal-en-passant semantics,
matching the frontend, and mutation failures are surfaced in the UI instead of
only rolling back optimistically.

Latest reliability repair: the local PostgreSQL database was missing the new
profile/line/drill migrations, which caused repertoire loading to return 500
after refresh; all pending migrations are now applied. Lichess player-explorer
responses label partial matching-game totals honestly while background indexing
continues; raw queue metadata is retained only for diagnostics.

Explorer source-switch repair: changing from the public database to “My games”
now invalidates the public result immediately, while subsequent Lichess
indexing polls retain and replace the latest personal partial snapshot instead
of flashing back to an empty table. The backend returns the latest promptly
available upstream snapshot so a matching-game count appears during indexing.
“My
games" now also shares the game-type filters (Bullet combines Lichess bullet
and ultraBullet, alongside blitz, rapid, classical, and correspondence) with
the public explorer; rating bands remain public-database-only. Public and “My games” selections are stored independently,
so switching sources restores each source's own months and game types. From/To
use explicit month/year selectors matching Lichess's supported granularity.

Latest My Games completion repair: identical partial snapshots no longer stop
automatic polling, the backend consumes a terminal ND-JSON line when it is
already promptly available after a queued snapshot, and the raw Lichess queue
number is no longer shown in the normal UI. This prevents an obsolete queue
position from lingering after Lichess has completed the result.

My Games status copy is now deliberately compact: `Found X games` ends in an
animated ellipsis while Lichess still reports indexing and a period once the
snapshot is final. Because Lichess can retain that indexing flag after its
aggregates stop changing, two identical snapshots also settle the visible
ellipsis to a period while bounded polling continues silently; later changes
make the ellipsis active again.

Coverage reliability: aggregate scoring now paces position requests and honors
Lichess `Retry-After` responses with a visible countdown and automatic resume,
rather than aborting the calculation on its first rate limit.

### Coverage-analysis redesign (planned)

The current dashboard calls a position “fully covered” only at effectively
100% (`>= 99.999%`) and averages position percentages equally. Replace those
rules with an exposure-oriented model:

- Use **95% covered reply mass as the proposed default “fully covered” target**,
  subject to fixture/user testing. Make the target a named constant and show it
  in explanatory UI rather than implying that every returned move is required.
- Compute the profile aggregate as `sum(coveredGames) / sum(totalGames)` across
  scored positions. This intentionally gives positions with larger matching
  Lichess samples more influence instead of treating a rare deep position like
  a common early position.
- Show both the weighted aggregate and distribution: fully covered positions,
  partially covered positions, and positions with no reliable sample. Do not
  collapse “no data” into 0% preparation.
- Rank uncovered replies by **impact** (`position exposure × reply frequency`,
  represented initially by the reply's matching-game count) so the next action
  is the gap most likely to occur, not merely the largest percentage at an
  obscure position.
- Treat the low-frequency tail explicitly. Proposed starting rule: moves below
  1% of the returned position sample do not prevent the “fully covered” label,
  but remain visible under “rare uncovered replies.” Revisit the threshold
  against real repertoires rather than silently discarding those moves.
- Add sample-confidence states. Avoid strong labels when the position has too
  few matching games; show the sample and allow the user to inspect it. The
  precise minimum belongs in the implementation contract and fixture review.
- Deduplicate normalized-FEN transpositions so one position is not scored twice
  merely because several authored paths reach it, while retaining path/module
  provenance for navigation.
- Keep coverage scoped to the active composed profile, selected color, Lichess
  filters, and database source. Never reuse public-database scores as My Games
  scores or vice versa.
- Add a prioritized gap list with “Open in explorer,” module provenance, reply
  frequency, sample size, and an explanation of why each gap affects the score.
- Cache/batch completed position scores where possible and support resumable
  calculation so rate limits do not throw away earlier progress.
- Test threshold boundaries, zero/low samples, transpositions, filtered data,
  highly skewed position frequencies, and the case where rare uncovered moves
  remain but the position still qualifies as fully covered.

One later refinement is reach-probability weighting from the repertoire root.
Raw Lichess totals deliberately emphasize common early positions but can
overwhelm deep preparation; empirical use should determine whether depth-aware
reach weighting is clearer than raw cross-position game totals.

### Similar-position drill feedback gap (planned)

Wrong-move feedback can currently say that the attempted move is prepared in a
similar repertoire position, but it provides no way to see that position or
understand the relevant difference. Treat the hint as incomplete until it is
actionable:

- Add **Compare positions** beside the hint. It must show the current drill
  position and the matched repertoire position, not merely name the match.
- Provide a phone-safe board toggle and a desktop side-by-side option. Preserve
  the active drill and wrong-move feedback while the comparison is open.
- Highlight piece-placement differences, side to move, castling rights, and
  en-passant rights. Do not limit comparison to the current placement-only
  Hamming score when rule-state differences make the move legal or sound in
  only one position.
- Show the matched profile/module, authored line, move-order prefix, and the
  prepared occurrence of the attempted move. Offer **View line in explorer**
  without destroying the drill session, matching existing completed-drill
  Explorer continuity.
- Explain the decisive difference only when supported by concrete evidence—for
  example, a defender is absent, a square is occupied, castling rights differ,
  or Stockfish shows a material evaluation change. Otherwise use neutral copy:
  “Compare the positions to see why the prepared move may not apply here.”
- Rank multiple matches by legality, normalized rule-state compatibility,
  piece-placement distance, active-profile provenance, and evaluation
  relevance; let the user inspect alternatives rather than silently choosing a
  confusing match.
- Until comparison UI ships, revise the existing message so it does not imply
  that the app has explained the difference when it has only detected a nearby
  position.
- Cover transpositions, reversed colors, castling/en-passant differences,
  several equally near matches, mobile navigation, and drill-session
  persistence in unit and browser tests.

- [x] Schema and API contract agreed and documented.
- [x] Backend profiles, modules, explicit paths, global releases, migrations,
  and multi-source drill persistence.
- [x] Frontend profile/module management, overlays, global-library flows, and
  versioned anonymous storage.
- [x] Selected-position drill filtering and both start modes.
- [x] Populated migration coverage and full PostgreSQL verification.
- [x] Move explorer path-saving from the compatibility graph endpoint to the
  explicit-line endpoint (edge removal retains its cascade-compatible route).
- [x] Load authored personal/global lines into composed drills so path identity
  and source provenance are used end to end.
- [x] Add integration coverage for the explorer-to-selected-drill launch.
- [x] Add “View in explorer” to completed-line review. It opens the exact
  authored occurrence/final position, while the mounted drill session persists
  so returning to Drills resumes it rather than starting over.
- [x] Re-run the complete frontend and PostgreSQL verification suites: 163
  frontend tests and 144 PostgreSQL backend tests, plus build, lint, migration,
  formatting, and OpenAPI checks.
- [x] Validate immutable global-release graph/line JSON before publication and
  preserve authored labels/source/order when copying a release.
- [x] Add an idempotent curator command for legal Vienna Game, Sicilian Defense,
  and Stonewall Attack starter releases.
- [x] Implement idempotent “Fill gaps” application of only missing global
  authored lines into the selected same-color editing module, exposed after
  preview/review in the global library.
- [x] Add per-line global gap diffing before application, including named/SAN
  missing-line review and a current-module line coverage count.
- [x] Preserve explicit root-to-leaf path identity on PGN import and mark
  imported authored lines with `pgn_import` provenance.
- [x] Repair browser line saving by aligning frontend/backend FEN semantics and
  expose repertoire mutation failures to the user.
- [x] Round-trip authored line labels through standards-safe PGN comments keyed
  to exact UCI paths; re-import updates metadata on an existing identical line.
- [x] Persist and round-trip per-ply brace/semicolon comments plus numeric and
  symbolic NAGs, with backend annotation validation.
- [x] Add real-game-frequency-weighted prepared-response coverage for the
  currently selected opponent position.
- [x] Aggregate weighted position coverage into an on-demand per-color
  dashboard with bounded sequential loading and visible progress.
- [x] Expose full anonymous multi-profile/module management in versioned local
  storage and the existing management UI (the server-backed global library is
  hidden until sign-in).
- [x] Add deterministic Chromium end-to-end coverage for anonymous profile and
  module persistence, signed-in explicit-line saving across refresh,
  explorer-to-selected-position drill launch, and public-to-personal explorer
  source switching with advancing partial snapshots.
- [x] Final contract audit and integrated verification: 159 Vitest tests, four
  Chromium end-to-end flows, 144 PostgreSQL backend tests, production frontend
  build, TypeScript, oxlint, Ruff check/format, migration drift, OpenAPI schema,
  and whitespace checks all pass.

This checklist is the user-facing implementation ledger. The detailed contract
below remains the source of truth for behavior and compatibility.

This is the implementation contract for the profile/module redesign. It
supersedes the graph-only assumptions in the frozen Phase 4 contract while
keeping every Phase 4 endpoint backward compatible during migration.

## Domain model

- A **personal opening module** is the existing `Repertoire` model: one
  user-owned, color-specific collection such as "My Vienna" or "Najdorf".
- A **profile** (`RepertoireProfile`) is a named composition such as Tournament
  or Blitz. `ProfileModule` attaches ordered, independently enabled personal
  modules. The same module may appear in several profiles.
- A module retains its normalized-FEN graph (`RepertoireMove`) for fast
  position lookups and transposition-aware overlays.
- An **authored line** (`RepertoireLine` plus ordered
  `RepertoireLineStep`) records one stable move order through that graph. Lines
  are the path/provenance layer; the graph is their position-oriented union.
- A **global opening template** is published in immutable, versioned releases.
  A profile may pin a release read-only, or a user may copy a release into an
  editable personal module. Published releases never change in place.

## Ownership and composition rules

- Every personal profile/module endpoint is scoped to the caller. Cross-user
  ids answer as not found or invalid without revealing existence.
- Exactly one personal module is the editing target for a displayed color.
  Other enabled personal modules and pinned global releases are read overlays.
- Identical overlay edges are deduplicated by `(origin FEN, UCI, resulting
  FEN)` while retaining all contributing component ids.
- Removing an edge modifies only its personal module. Global releases are
  read-only.
- A profile may be deleted without deleting its reusable modules. Deleting a
  module removes only its profile memberships and its own drill history.

## Authored-line mutation contract

`POST /api/v1/repertoires/{id}/lines/`

```json
{
  "label": "Main line",
  "source": "manual",
  "steps": [
    {"originFen": "...", "san": "e4", "uci": "e2e4", "resultingFen": "..."}
  ]
}
```

- Steps must form one legal, connected path beginning at the standard initial
  position. FENs are normalized at the boundary.
- The service reuses/creates graph edges transactionally.
- Exact duplicates are idempotent.
- Extending a terminal prefix replaces the shorter terminal line; saving a
  prefix of an existing line is a no-op.
- Sibling branches remain independent.
- The response is the complete ordered line list.

`DELETE /api/v1/repertoires/{id}/lines/{line UUID}/` deletes that authored
line and prunes graph edges no longer referenced by any surviving line.

The existing graph `POST/DELETE .../moves/` endpoints remain supported while
old clients exist. They synchronize explicit lines from the resulting graph.

## Profile and module APIs

- Existing `GET/POST /repertoires/` lists/creates personal modules.
- `PATCH/DELETE /repertoires/{id}/` renames/describes or deletes a module.
- Existing profile CRUD and `/profiles/{id}/modules/` membership endpoints
  remain as documented in `backend/API_CONTRACT.md`.
- Profile responses contain ordered personal modules and pinned global release
  components.

## Global library APIs

- `GET /opening-templates/` lists published global templates and their latest
  release metadata.
- `GET /opening-templates/{slug}/releases/{version}/` returns an immutable
  release snapshot (metadata, graph, and authored lines).
- `POST /profiles/{id}/template-releases/` pins a release read-only.
- `DELETE /profiles/{id}/template-releases/` removes that pin.
- `POST /opening-templates/{slug}/releases/{version}/copy/` creates an editable
  personal module owned by the caller, preserving release provenance. An
  optional `profileId` attaches it immediately.

Publishing and editing global templates is admin-only in this phase; public API
endpoints are read/use operations.

### Immutable release JSON

Each `OpeningTemplateRelease` stores a self-contained snapshot rather than live
foreign keys into a curator's working module:

- `tree` uses the ordinary repertoire-tree wire shape: normalized origin FEN
  keys whose values are ordered `{san, uci, resultingFen}` edge arrays.
- `lines` is an ordered array of release-local line objects containing stable
  string ids, labels/source/order metadata, and complete ordered move steps.

That duplication is intentional: a pinned release must render and drill exactly
as published even if personal modules or later template versions change. The
model rejects ordinary `save()` calls for an existing release. Releases are
created through Django admin in this phase, so publishing must validate the JSON
against these shapes before production content is loaded; database-level bulk
updates are an administrative escape hatch and are not a supported edit path.
Copying imports the release graph, records `source_release` on the new personal
module, and preserves the release's explicit line labels, sources, and ordering.

## Drill contract

A drill session snapshots all contributing sources rather than attributing a
composed drill to one arbitrary module.

`POST /api/v1/drills/sessions/`

```json
{
  "repertoireIds": [1, 2],
  "templateReleaseIds": [7],
  "isRetryPass": false,
  "startMode": "beginning",
  "selectedFen": null,
  "selectedPly": null,
  "prefixUci": []
}
```

- `startMode` is `beginning` or `selected_position`.
- `selectedFen`, `selectedPly`, and `prefixUci` snapshot the launch context.
- The legacy singular `repertoireId` request remains accepted and is normalized
  to a one-element module set.
- Session/source join rows survive profile edits. Line results continue storing
  a session-time UCI key rather than relying only on a live line FK.

## Selected-position drill behavior

The explorer launches drills with `{selectedFen, selectedPly, prefixUci}` and
one of two presentation modes:

1. **Start at this position**: retain only lines containing the selected
   occurrence, slice their practiced steps after it, and initialize the board
   at the selected complete FEN.
2. **Start from move 1**: retain the same eligible lines but practice their full
   prefixes from the initial position.

Exact UCI-prefix matching chooses the occurrence reached in the explorer.
Normalized-FEN matching is a fallback for launches without a move history.
Identical lines contributed by several components are drilled once with source
provenance retained.

## Migration and compatibility

- Migration `0002` creates Default profiles, attaches existing modules, assigns
  deterministic move order, and derives explicit lines without changing
  repertoire/move ids.
- Anonymous v1 `{white, black}` and v2 Default-profile local storage remain
  readable. The frontend now writes a versioned v3 multi-profile/module store;
  migration preserves the prior JSON under a backup key.
- Existing drill sessions backfill their singular module into the new source
  join table.
- Verification must cover fresh migrations, populated `0001 -> latest`
  migration, API ownership, line/graph consistency, overlay provenance,
  selected-position filtering/slicing, PGN round trips, and legacy endpoint
  compatibility.

## Implementation status

Implemented in this slice:

- Profile/module CRUD and membership management, active profile and per-color
  editing-module selection, merged overlays, and move provenance badges.
- Explicit-line persistence and mutation endpoints while graph mutations remain
  backward compatible.
- Immutable JSON global releases, discovery/preview, read-only profile pins, and
  editable copies with source provenance.
- Multi-source drill-session attribution plus both selected-position start modes.
- Populated `0001` migration coverage for profiles, explicit lines, deterministic
  move ordering, and legacy drill-session source backfill.

Deferred beyond this implementation contract:

- First-class global publishing is a Phase 6 follow-up. Authorized curators
  need an in-app workspace to select a personal module, save release metadata
  as a draft, validate and preview its lines/annotations/start anchor, and
  publish a new immutable version with changelog, provenance, permissions, and
  audit history. The existing creation-time validation, Django-admin path, and
  seedable starter content remain the lower-level foundation.
- Module/global-release start anchors are a Phase 6 follow-up: persist a
  normalized FEN together with the preferred UCI prefix/ply, derive a sensible
  common-prefix default, validate it against authored lines, and display it in
  module cards, global previews, explorer navigation, drills, and coverage.
- Weighted real-world coverage scoring is shipped for both the selected
  opponent position and an on-demand per-color aggregate dashboard; per-line
  global gap diffing plus idempotent “Fill gaps” application is also shipped.
- Anonymous users can create, rename, compose, enable, order, and select local
  profiles/modules through the same management UI. The global library remains
  hidden until sign-in because pin/copy operations require backend ownership.
- Path-saving stars now author explicit lines. Edge removal intentionally retains
  the transposition-aware cascade endpoint. PGN imports now create explicit
  paths with source provenance, and authored labels plus per-ply comments/NAGs
  round-trip through PGN and backend persistence.
- Production-environment verification remains part of deployment/hosting work,
  not this data/UI contract. Local verification includes deterministic Chromium
  flows and the complete backend suite against PostgreSQL 16.
