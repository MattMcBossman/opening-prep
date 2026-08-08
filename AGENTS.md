# opening-prep

## Overview
A web app for building and drilling a personal chess opening repertoire. Primarily inspired by **Chessly (GothamChess)** — particularly its drills mode, where users practice repertoire lines and get feedback on mistakes — with additional inspiration from **openingtree.com** (included as a git submodule at `openingtree/`), which pulls opening statistics for a given player/lines from Lichess and Chess.com game history.

This file is the persistent project reference for Warp/agent-assisted development. Keep it up to date as scope, architecture, and decisions evolve.

Whenever a change in this repo would make `README.md` inaccurate or incomplete (setup steps, scripts, project layout, or overall status/roadmap), update `README.md` in the same change — don't wait to be asked.

## Inspiration source: `openingtree/` submodule
`openingtree/` is a pre-existing React app (CRA-style, React 16, custom webpack scripts) that already implements:
- Lichess and Chess.com API iterators for pulling a player's game history (`src/app/iterator/LichessIterator.js`, `ChessComIterator.js`, `BaseLichessIterator.js`).
- PGN loading/parsing (`src/app/PGNReader.js`, `src/pres/loader/PGNLoader.js`).
- An opening move tree/book built from games (`src/app/OpeningBook.js`).
- Time-control and other filters (`src/pres/loader/AdvancedFilters.js`, `TimeControlLabels.js`).
- Lichess OAuth login flow (`src/edge/lichessloginworker/`).

Treat this submodule as a **reference implementation only**: port the API integration patterns and edge-case handling (pagination, rate limits, time-control filtering) by reimplementing them against the new stack, rather than importing this code directly — it's coupled to an old toolchain (React 16, CRA, its own state layer) that isn't worth carrying forward.

## Key Features

### 1. Opening explorer
- Browse an opening line move by move, with the line/variation name shown (e.g. "Sicilian Defense, Najdorf Variation").
- Engine evaluation (Stockfish or similar) for every position reached.
- Move/result statistics pulled from Chess.com and/or Lichess public APIs for every position (popular next moves, win/draw/loss rates).

### 2. User repertoire builder
- Users save a personal tree-style repertoire, separately for White and Black.
- Only the repertoire owner's own moves are independently toggleable — you can't star an opponent's reply on its own. But saving one of your own moves also saves every earlier ply in that line, including the opponent's replies along the way: e.g. as White, starring 3.Bb5 in 1.e4 e5 2.Nf3 Nc6 3.Bb5 also saves 1.e4, 1...e5 (the opponent continuation you've prepped 2.Nf3 for), 2.Nf3, and 2...Nc6. So the tree really does contain both colors' moves; the UI just never lets the opponent's moves be saved/removed except as a side effect of saving one of your own moves deeper in the line.
- Built directly into the explorer page rather than as a separate viewer: the move list shows the line played so far, then — in the same aligned grid (move number, then the move in the correct White/Black column) — whatever's saved from the current position, so the whole repertoire can be walked just by clicking. The move list's own-move-only save toggle (one star per row, on whichever side holds that color's move) doubles as the removal control for saved continuations. The Lichess explorer table also flags rows already saved to the repertoire (including opponent replies you've prepped a response for), without an equivalent star toggle there.
- Removing a saved move also deletes everything beneath it that's now unreachable — unless a descendant position is still reachable via some other saved line (a transposition into the same position), in which case that shared subtree is kept.
- Removing one of your own moves can also delete its parent: if that was the last of your responses to a given opponent reply, the now-response-less opponent reply is deleted too (recursively bounded to that one step — an opponent reply's own parent, one of your moves, is never deleted this way). The reverse never happens automatically: one of your moves with no opponent reply prepped yet underneath it is a normal, valid state, not something to prune.
- Switching between the White and Black repertoire (the board-color toggle) resets the board and move list, since the two repertoires are unrelated lines.
- No conflict detection: any number of moves may be saved from a given position, forever.
- Per-position view (via the explorer page) shows:
  - Engine evaluation
  - Chess.com/Lichess aggregate statistics
  - Optionally, the user's own stats if they link a Chess.com/Lichess account
- Gap detection: surface repertoire positions that are under-covered relative to real-world move-likelihood stats and/or evaluation (e.g. opponent replies with no prepared response).
- (Long-term) Suggest similar positions already in the repertoire when a gap is found.
- (Long-term) Compare/diff similar positions (similarity heuristic: Hamming distance over piece placement, to start) to highlight key transposable differences.

### 3. Player data via `openingtree` submodule
- Explore a specific player's (e.g. a GM's) games to inspire repertoire choices.
- Analyze the user's own games to find where they deviate from their saved repertoire.
- Support time-range filters: last 24h, last week, last month, last year, all time.

### 4. Drills (Chessly-style)
- Drill mode: pick a branch/subtree of the repertoire to practice.
- On an incorrect move:
  - If it's objectively a bad move, show the engine line explaining why.
  - If it's not bad but simply not the prepared line, say so plainly.
  - If the played move is actually correct in a similar/transposed position, show that position and highlight the differences.
- Track per-position statistics on incorrect attempts to highlight weak spots in the user's preparation.

## Additional Features (Approved)
- **Position identity via FEN, not move order** — key node identity by normalized FEN (+ side to move/castling/ep rights) so transpositions are recognized as the same repertoire node regardless of move order.
- **ECO/opening-name lookup** — resolve line/variation names from an ECO database instead of hand-entry, with manual override. The override input was prototyped in the explorer in Phase 1 but removed as noise there (no repertoire to attach an override to yet); not yet re-added — revisit once there's a natural place to persist an override per repertoire node.
- **Rating-band-aware statistics** — Lichess/Chess.com explorer stats vary a lot by rating bucket; let users filter stats to a relevant rating range rather than only all-time/all-rating aggregates.
- **Repertoire coverage dashboard** — a single view summarizing, per color, % of opponent replies (weighted by real-world frequency) that are covered by a prepared response, not just a raw gap list.
- **Spaced-repetition drilling** — prioritize weak/incorrect lines more often in drill sessions (Anki-style scheduling) instead of uniform random selection.
- **Move/position annotations** — free-text notes per repertoire node (why this move, traps, plans), shown in explorer and drills.
- **PGN import/export** — import existing repertoires from PGN/Lichess studies/ChessBase exports; export the repertoire as annotated PGN.
- **Multiple repertoire profiles** — e.g. separate prep for different time controls or anticipated opponent styles.
- **Client-side engine via WASM Web Worker** — run Stockfish (or similar, e.g. lc0 if feasible) fully client-side in a Web Worker for evaluation, avoiding server compute cost; consider an optional server-side eval cache keyed by FEN to avoid recomputing common positions.
- **API response caching layer** — cache Chess.com/Lichess explorer responses (keyed by FEN) to respect rate limits and speed up repeated exploration of popular positions; also cache computed engine lines (eval + best/refutation line) for moves flagged as mistakes in drills, so repeated wrong moves don't require recomputation.
- (Long-term) **Play vs. bot** — play out a game against an engine bot of configurable skill level, starting from any selected position (e.g. an explorer/repertoire node), to test lines interactively beyond scripted drills.

## Architecture Direction (Decided)
- **Frontend**: React, with `react-chessboard` for the board (MIT license, native React integration, built-in arrow/shape support for engine lines and position-diff highlighting — chosen over `chessground` mainly to avoid its GPL-3.0 license) and `chess.js`-equivalent move/FEN logic — independent of `openingtree`'s CRA/React 16 stack.
- **Engine**: Stockfish compiled to WASM, run in a Web Worker, no server dependency for evaluation. Use iterative deepening: a fast shallow pass for snappy browsing, continuing to deepen in the background while a position stays selected, with a deeper/longer pass when drills need to explain a mistake; cache the deepest result reached per FEN(+move).
- **Backend**: Django + Django REST Framework + PostgreSQL, for user accounts, saved repertoires, drill statistics, and the FEN-keyed cache table for Chess.com/Lichess/engine-line lookups. Django admin doubles as a dev-time inspector for cached data and repertoire trees. Not built yet: the Phase 2 repertoire is persisted client-side only (`localStorage`, keyed by normalized FEN per color), matching the existing Lichess-token/board-color pattern; migrate to this backend once accounts are actually needed.
- **Data sources**: Chess.com Published-Data API and Lichess API (opening explorer + account OAuth), reusing patterns from `openingtree/src/app/iterator/*`. As of 2026, Lichess requires a personal API token (Bearer auth) on every Opening Explorer request (endpoint moved to `explorer.lichess.org`); the frontend collects this token client-side (stored in `localStorage`) until account linking exists, at which point it can move server-side.

## Development Roadmap
Tracks implementation progress. Check off a phase once it has shipped; update sub-items as needed. Decision: keep Phases 3-5 as single phases for now, revisit splitting after Phase 1-2 ship.

- [x] **Phase 0 — Project setup**: scaffold the frontend app, minimal backend/DB schema, chess.js + board wiring.
- [x] **Phase 1 — Opening explorer (MVP)**: line browser, Lichess explorer stats (cached by FEN, requires a user-supplied Lichess API token), Stockfish WASM evaluation (iterative deepening), opening name from Lichess explorer response (no manual override here — see "ECO/opening-name lookup" above). Chess.com explorer stats not yet integrated (Lichess-only for now).
- [x] **Phase 2 — Repertoire builder**: FEN-keyed repertoire tree per color (normalized-FEN identity for transpositions), built directly into the explorer page (own-move-only save toggle in the move list that cascades to save every earlier ply including opponent replies, saved continuations merged into the same move-list grid, Lichess-explorer annotation), `localStorage` persistence. Removing a move cascades to delete now-unreachable descendants (preserving shared transpositions) and, if that leaves an opponent reply with no response of yours left, that reply too. Toggling White/Black repertoire resets the board. No conflict detection — unlimited branches per position.
- [ ] **Phase 3 — Drills (Chessly-style)**: drill sessions on a repertoire subtree, wrong-move handling (bad-move explanation, off-book notice, transposition check via Hamming-distance similarity), mistake tracking.
- [ ] **Phase 4 — Player data via `openingtree`**: port Lichess/Chess.com game iterators + PGN parsing, time-range filters, GM-inspiration browsing and own-game deviation analysis.
- [ ] **Phase 5 — Gap detection & long-term features**: repertoire coverage dashboard, similar-position suggestions/diffing, spaced repetition, PGN import/export, multiple profiles, play-vs-bot from a selected position.

