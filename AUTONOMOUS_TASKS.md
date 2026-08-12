# Autonomous branch queue

These tasks are isolated, reviewable, and executable without user product
input. Each should use its own branch from the same reviewed base. Do not merge
branches automatically.

At the end of the work period, report for every branch: commits, files changed,
tests run, screenshots or API examples where relevant, known risks, and the
specific review action requested.

## Progress

| Task | Branch | Status | Result |
| --- | --- | --- | --- |
| T1 | `autonomous/t1-opening-name-hardening` | Completed | `85dbab8`; curated-FEN validation, cache override/ECO integration coverage, and retained-name loading behavior. |
| T2 | `autonomous/t2-module-manager-regressions` | Completed | `1382800`; five-viewport manager/action/focus coverage and cross-color View module fix. |
| T3 | `autonomous/t3-player-index-lifecycle` | Completed | `483cc15`; deterministic ingestion lifecycle, isolation/filter/retry tests, and IndexedDB recovery documentation. |
| T4 | `autonomous/t4-api-schema-audit` | Completed | `7a44313`; warning-free validated OpenAPI, streaming export coverage, and reconciled contract. |
| T5 | `autonomous/t5-accessibility-audit` | Completed | `c72d530`; keyboard tabs, modal/sheet focus and Escape behavior, accessible relationships, and reduced-motion coverage. |
| T6 | `autonomous/t6-session-restoration` | Completed | `c5cfc56`; validated session parsing plus refresh, isolation, module, filters, and selected-drill browser coverage. |
| T7 | `autonomous/t7-cache-error-paths` | Completed | `b170982`; failed-refresh preservation and retry-countdown boundaries added to existing 429/502/single-flight coverage. |
| T8 | `autonomous/t8-dependency-attribution` | Completed | `0ef8bd4`; dependency/data/API inventory and draft third-party notices with unresolved provenance/legal flags. |
| T9 | `autonomous/t9-opening-seed-safety` | Completed | `61674a0`; legacy seed refusal for curated catalogs plus safe dry-run reporting. |
| T10 | `autonomous/t10-retired-player-index` | Completed | `11b20cc`; unreachable server player-query contract removed and live export→IndexedDB boundary documented/tested. |

## Ready

### T1 — Opening-name override hardening

- Validate curated FENs and reject invalid positions cleanly in model/admin use.
- Add cache-hit and cache-miss integration tests proving curated names override
  Lichess names without mutating cached payloads or statistics.
- Test ECO fallback when a curated name omits its own ECO value.
- Verify the old name remains rendered throughout a new-position lookup.

Scope: tests and correctness only; do not curate names or change naming policy.

### T2 — Module-manager regression coverage

- Extend browser coverage for profile disclosure, View module, Duplicate,
  attach/detach, More, and close/focus restoration.
- Cover 320–430px phone widths and one desktop viewport.
- Assert no document/dialog horizontal overflow and stable control ordering.

Scope: preserve the accepted UI; fix only objective regressions uncovered by
the tests.

### T3 — Personal-game index lifecycle tests

- Add deterministic worker/index tests for incremental per-game count updates,
  completion, restart/resume, duplicate games, source filtering, and 429 retry.
- Verify Chess.com and Lichess ingestion cannot overwrite each other's records.
- Document the current IndexedDB schema and recovery behavior beside the worker.

Scope: no new visible controls and no storage-policy decisions.

### T4 — API contract and schema drift audit

- Generate and validate the OpenAPI schema.
- Reconcile undocumented current endpoints/fields and remove claims for routes
  that no longer exist.
- Add or tighten a repeatable schema-validation command/test if one is missing.

Scope: documentation, annotations, and contract tests; no endpoint redesign.

### T5 — Accessibility regression audit

- Audit the Explorer header/menu, module-manager dialog, mobile tabs, board
  controls, and drill completion controls for accessible names, focus order,
  dialog containment/restoration, keyboard operation, and reduced motion.
- Add deterministic assertions for confirmed behavior and fix unambiguous
  violations without redesigning layout or copy.

Scope: standards/correctness fixes only. Put subjective visual changes in the
branch report instead of implementing them.

### T6 — Session restoration regression suite

- Cover refresh restoration of Explorer history, pointer, source-specific
  filters, mobile section, selected module, and selected-position drill launch.
- Verify tab-scoped state does not leak into a fresh browser context.
- Test malformed/old session payload fallback without destroying valid module
  data.

Scope: persistence correctness only; no change to what Mainline persists.

### T7 — Cache and rate-limit error-path tests

- Exercise Lichess 429 `Retry-After`, upstream timeout/502, stale-cache behavior,
  concurrent single-flight, and frontend retry/countdown copy.
- Verify failures never replace a usable completed result with an empty result.
- Close objective gaps found in tests while retaining current retry policy.

Scope: existing behavior and resilience, not new retry-policy decisions.

### T8 — Dependency and attribution inventory

- Produce a factual inventory of production dependencies, bundled engine/assets,
  opening data, external APIs, declared licenses, source links, and missing or
  ambiguous license information.
- Draft `THIRD_PARTY_NOTICES` entries only where obligations are clear.
- Flag ambiguity for owner/legal review; do not choose Mainline's license or
  make legal conclusions.

Scope: research and documentation only.

### T9 — Legacy opening-seed safety

- Add an explicit safety contract around `seed_opening_templates` so it cannot
  silently recreate retired global releases in a curated database.
- Cover empty/demo database behavior and non-empty curated database refusal or
  dry-run reporting with backend tests.
- Reconcile command help and generator/publication documentation.

Scope: safety and tests only. Do not decide which openings should be globally
published and do not mutate the developer or Render databases.

### T10 — Retired player-index path audit

- Trace the skipped legacy server-side My Games contract and any now-unused
  serializers, models, cache code, settings, and documentation after the
  IndexedDB worker migration.
- Remove only code proven unreachable, or document why a compatibility path is
  still required.
- Keep migrations intact unless a forward cleanup migration is demonstrably
  necessary; add regression tests around the live browser-index path.

Scope: dead-code and contract cleanup only; no player-index redesign or data
deletion against a real database.

## Not autonomous yet

Coverage scoring changes, profile-manager redesign, onboarding, account
deletion/export, spaced repetition, community moderation policy, opening-name
curation, publishing UX, and new user-facing analysis claims all require user
review or a product decision before implementation.
