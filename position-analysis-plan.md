# Cached end-of-drill position analysis plan

## Status and objective

Last updated: 2026-08-10.

A0 and the bounded A1 cached-candidate review are complete. A2 concrete board
facts are implementation-complete but still require hands-on product review.
A2 provides a versioned server-owned feature cache, deterministic
material/pawn/file/activity/king/tactical facts, legal-move before/after diffs,
engine-backed mate/evaluation-swing warnings, and selectable board evidence.

The review should explain what Stockfish thinks, which moves and setup ideas
recur over roughly the next five moves, which urgent responses must precede a
plan, and which tactical or positional features matter. It should compare
prepared moves, engine choices, and human play without conflating them.

Do not expose sampling mechanics as prose like “d4 appears in 4 of 5 lines.”
Keep exact evidence internally, but say “The d4 break is a recurring idea” or
“Black commonly prepares ...d5 with ...Re8; playing ...d5 immediately permits
a tactical response.”

## Principles

1. Compute structured evidence before prose; never invent a chess explanation.
2. Cache objective position facts globally by normalized FEN. Keep facts about
   the preceding move/history in a separate contextual comparison.
3. Initially compute Stockfish results in the browser and upload them. Server
   engine workers are optional later work, not a hosting prerequisite.
4. Keep the strongest compatible cached result; shallow uploads never replace
   stronger ones.
5. Version engine settings, feature rules, motif rules, and summary wording.
6. Use calibrated language and suppress uncertain findings.
7. Render cached results immediately, enrich in the background, and never block
   Next/Finish or View in explorer.
8. Use mobile-first progressive disclosure and selectable board-arrow layers.
9. Treat a material disagreement between a cached parent evaluation and a
   deeper evaluation after its recommended move as search instability. Never
   copy the child score backward into the parent: re-search the parent at a
   stronger budget so Stockfish can either revise its score or choose a
   different best move.

## Parent/child evaluation consistency

A nominal depth-20 parent search usually examines its chosen move with roughly
one fewer ply remaining than a fresh depth-20 search from the resulting
position. Selective search and the extra ply can therefore produce results such
as “best move ...Be6, -0.57” followed by “after ...Be6, 0.00.” This is not enough
to overwrite the parent cache entry with the child score, because the child
evaluates only that branch and another parent move may become preferable.

Frozen reconciliation contract (implementation remains a post-A1 task):

- Compare scores from White's perspective only when the child is reached by the
  parent's cached rank-one move and both results use the same engine build and
  analysis family. A centipawn disagreement is material at 40 cp or more.
- Any mate/non-mate disagreement, mate winner sign reversal, or mate-distance
  disagreement greater than three plies is material. Two same-sign mate scores
  within three plies are stable; centipawn values are never compared with mate.
- Mark the parent provisional and re-search it once at four additional plies,
  capped at depth 26. Keep displaying the prior score with `Rechecking unstable
  evaluation…`; Next/Finish and View in explorer remain enabled.
- Permit one attempt per `(normalized FEN, engine build, analysis profile,
  original depth)` per browser session. Never recursively reconcile the retry
  or retry an equal-or-weaker cached result, preventing parent/child ping-pong.
- Only the stronger parent re-search can clear or replace the parent result.
  Never copy a child score backward. If disagreement remains, retain the
  stronger parent, label it `Unstable at current search depth`, and stop.

## Recurring moves and plans

Analyze several competitive MultiPV lines for 8–12 plies. For recurring moves,
store side, UCI/SAN, typical ply window, evaluations, preceding moves/features,
whether playing the move immediately is inferior, resulting feature changes,
and confidence. Normalize castling and merge identical moves.

Classify relationships as preparation, forced delay, conditional plan,
premature execution, or transposition. Headlines use qualitative language;
exact line counts remain debugging/evidence data. The existing blue Lichess
arrows and green multi-branch player replies remain empirical statistics.
Future engine-plan arrows need a separate legend.

## Analysis sources

- **Stockfish:** evaluation, mate, MultiPV candidates, refutations, and evidence
  that a thematic move needs preparation. Prefer reproducible node budgets to
  time limits.
- **A project-owned `python-chess` feature extractor:** use legal moves, attack
  maps, pins, checks, and piece sets to derive higher-level facts. Stockfish
  validates importance; engine evaluation trace may supplement but must not be
  a required, version-fragile interface.
- **Lichess explorer:** human popularity and results for the final and follow-up
  FENs. Keep popularity distinct from quality. Never put private “My games”
  aggregates in a global cache.

## Data model and cache identity

Extend, rather than silently overload, the legacy single-PV
`EngineEvaluationCache`.

### `PositionAnalysis`

- normalized FEN including side, castling, and legal en-passant rights;
- engine name/version/build and named analysis profile;
- MultiPV, depth, nodes, elapsed time, score/mate, and best move;
- candidate lines as validated UCI/SAN plus per-line score/depth/nodes;
- feature/summary schema versions, status, timestamps, source, and checksum.

Compatibility key: `(normalized_fen, engine, engine_major_version,
analysis_profile)`. Replacement must compare both breadth and strength; depth
alone is insufficient.

### `PositionFeatureSet`

Store versioned material, pawn, activity, space, king-safety, and tactical
facts with severity/confidence and referenced squares/pieces.

### `PositionPlanSummary`

Store recurring moves, prerequisite relationships, deterministic summary
blocks, and evidence links to lines/features.

Path-specific analysis uses `(origin_fen, played_uci, resulting_fen, profile)`.
Repetition claims also require move history and remain session-local initially.

## API direction

```text
GET/PUT  /api/v1/explorer/position-analyses/
GET      /api/v1/explorer/position-features/
GET      /api/v1/explorer/move-comparisons/?fen=...&move=...
```

Before implementation, specify these in `backend/API_CONTRACT.md`. Uploads must
be authenticated initially; replay every PV with `python-chess`, recompute FENs,
normalize castling, bound payload/MultiPV/plies, validate numeric ranges, apply
idempotency and rate limits, and reject client-supplied prose as authoritative.
Objective reads may be shared publicly.

## A0 fixture contract

`backend/explorer_cache/tests/fixtures/position_analysis_cases.json` covers
quiet development, a tactical forced capture, a forced check response, castling
rights, legal en passant, promotion, transposed move orders, and deliberately
misleading recurrence. Every PV must replay legally. Expected output names only
mechanical facts: a legal first move, exact recurring UCI moves, or identical
resulting FENs. `unsupportedClaims` documents conclusions A1 must never draw.
Tests avoid exact centipawn expectations except for synthetic comparison math.

## Phased roadmap

### A0 — Contract and fixtures (foundation; easy)

- [x] Freeze FEN normalization and compatible-result replacement rules.
- [x] Define parent/child disagreement thresholds, mate handling, re-search
  budget, loop prevention, and the provisional-result UI state.
- [x] Measure phones and choose depth-24 target, MultiPV breadth, and ply horizon.
- [x] Define the A1 candidate and recurring-move evidence JSON schemas.
- [x] Build fixtures covering quiet/tactical play, forced replies, castling, en
  passant, promotions, transpositions, and misleading feature examples.
- [x] Document expected facts without brittle exact centipawn scores.
- [x] Update API contract and design migrations.

Exit: schemas and replacement rules are reviewable and fixtures cover known
failure modes.

### A1 — Basic cached review (easy; implement soon)

- [x] Add model/migration/admin, validated GET/PUT, and keep-strongest upsert.
- [x] Collect three depth-24 candidate lines, roughly 8–10 plies each, under a bounded
  phone-safe browser Stockfish budget.
- [x] Show cache immediately; deepen missing/weaker results and upload them.
- [x] Extract recurring later-ply moves, ordering, and basic
  immediate-versus-prepared evaluation comparisons.
- [x] Render verdict, candidates, concrete recurring moves, common human play, and
  expandable representative lines with qualitative language.
- [x] Keep completion stationary (no auto-scroll), preserve session state and
  reduced motion, and keep desktop/mobile primary actions below the board.
- [x] Add migrations, API validation/replacement tests, frontend unit tests, and
  mobile/desktop browser tests.

Explicitly exclude broad strategic claims. A1 may call a pawn break recurring
or an immediate move premature; it may not assert a lasting weakness without a
feature rule.

Exit: a later visit reuses the cache, illegal uploads fail, phones can leave the
review immediately, and recurring moves are useful on fixtures.

### A2 — Concrete board facts (easy-to-medium; first return)

Implementation complete; awaiting user review and acceptance.

- [x] Material imbalance and bishop pair.
- [x] Passed, connected, isolated, and doubled pawns.
- [x] Open/semi-open files and pieces using them.
- [x] Development, uncastled king, mobility, checks, and captures.
- [x] Loose, attacked, defended, pinned, and simply hanging pieces.
- [x] Forced mate and major evaluation-swing warnings.
- [x] Before/after feature diffs and selectable square/piece evidence.

Exit: every displayed fact has board evidence and positive/negative fixtures.

### A3 — Positional interpretation (medium; second return)

- [ ] Useful, sustainable outposts and whether enemy pawns can challenge them.
- [ ] Backward pawns that are realistic targets.
- [ ] Usable space and enemy-piece restriction.
- [ ] King shelter, open lines, attack-zone pressure, defenders, and castling.
- [ ] Truly trapped/restricted pieces versus temporary low mobility.
- [ ] Candidate pawn breaks and necessary preparation.
- [ ] Overloads, forks, skewers, discoveries, and removed defenders, confirmed
  by engine consequences.
- [ ] Relevance ranking and redundant/contradictory finding suppression.

Exit: curated fixture review favors precision; uncertain labels are omitted.

### A4 — Plans and move-order explanations (medium-to-hard; later return)

- [ ] Cluster recurring moves into maneuvers, breaks, exchanges, defensive
  tasks, and reroutes.
- [ ] Infer prerequisites from ordering plus counterfactual immediate analysis.
- [ ] Explain threats that delay a plan and recognize plans across transpositions.
- [ ] Produce concise templates with expandable representative evidence.

Exit: claims like “prepare ...d5 with ...Re8” have a sound prepared line and a
concrete drawback to immediate ...d5.

### A5 — Playability and coaching quality (hard; backburner)

- [ ] Estimate flexibility from viable moves, evaluation stability, and
  transpositional options.
- [ ] Estimate easy/natural play from acceptable-choice breadth,
  opponent-only-move pressure, and punishment for plausible inaccuracies.
- [ ] Separate durable strengths from transient tactics and improve plan
  equivalence across different lines.
- [ ] Consider generated prose only as a renderer over approved evidence, with
  deterministic fallback and user feedback for bad findings.

Exit: subjective labels are calibrated, explainable, and more useful than A4.
There is no deadline for this phase.

### A6 — Optional server compute (hard/operational; only if justified)

- [ ] Measure hit rate, phone time/battery, and uploads first.
- [ ] Only if needed, add a deduplicated bounded Stockfish worker queue with
  quotas, cancellation, observability, and deployment resource limits.
- [ ] Retain client fallback and never block drill completion on the queue.

## Definitions requiring care

- Backward pawns require feasible advances, support, enemy control, and actual
  pressure; shape alone is insufficient.
- Outposts must be useful, sustainable, hard for enemy pawns to challenge, and
  improve activity.
- Trapped pieces differ from pieces with temporarily low mobility.
- King safety combines shelter, lines, forcing moves, attackers, and defenders;
  “uncastled” alone is not unsafe.
- Space means usable controlled territory and restriction, not raw attacks.
- Hanging/overloaded claims must account for pins, x-rays, and recaptures.
- Passed-pawn importance includes protection, connection, opposition, and
  promotion prospects.
- Flexible/easy labels are estimates and must expose their proxies.

## UX

Show one verdict, at most three priority “Ideas and cautions,” selectable arrow
layers with a legend, separate Common play and Engine ideas, expandable feature
groups, and representative evidence. Selecting a fact highlights its board
squares. Avoid arrow clutter and layout shifts; keep View in explorer and
Next/Finish persistently reachable.

## Verification

- Unit-test normalization, PV replay, replacement ordering, aggregation, and
  every feature with positive/negative/boundary/mirrored/transposed fixtures.
- Assert legal moves and invariants, not exact engine scores.
- Migration-test populated legacy evaluation data.
- API-test permissions, malformed/oversized data, idempotency, concurrency, and
  keep-strongest behavior.
- Browser-test cached, missing, partial, failed, and upgraded analysis at phone
  and desktop sizes.
- Maintain a human-reviewed golden-position report of facts and prose.

## Risks and deferred decisions

Control false authority with evidence and conservative suppression; engine
instability with node budgets/versions; cache growth with indexes/metrics and a
later retention policy; malicious uploads with legal replay and rate limits;
phone cost with cache-first bounded analysis; UI overload with prioritization.

Deferred: exact engine budget/build, task execution mechanism, retention and
backups, LLM prose, paid compute, and always-on hosting.
