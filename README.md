# Mainline

A web app for building and drilling a personal chess opening repertoire, inspired by Chessly's drills mode and openingtree.com's player-stats explorer. See [AGENTS.md](AGENTS.md) for the full project reference (features, architecture decisions, and roadmap).

## Status

Phase 1 (opening explorer MVP) is implemented: move-by-move line browser (step through the line with the Back/Forward buttons or the ←/→ arrow keys), Lichess Opening Explorer stats (normalized-FEN/filter-keyed browser and PostgreSQL caches; requires a user-supplied token when signed out), and client-side Stockfish (WASM) evaluation with iterative deepening. Stockfish results are shared across explorer/drill consumers in memory and, when signed in, persisted by normalized FEN plus engine build so revisiting a position can skip analysis.

Explorer history, the active page/phone section, data source and filters, and a selected drill starting position are retained in tab-scoped `sessionStorage`, so a refresh or development-server reload restores the working context without making it permanent across browser sessions.

Phase 2 (repertoire builder) is implemented: a FEN-keyed repertoire tree per color, built directly into the explorer page — save/remove any played move via a toggle in the move list, browse saved continuations from the current position, and see which Lichess-explorer moves are already part of your prep.

The Moves panel keeps played history in its score grid and presents preparation below it as a collapsible tree rooted at the current position. Forced move/reply pairs share compact rows, collapsed branches show their fully traversed leaf-line count, deep moves navigate through the exact saved path, and transpositions terminate with a reference instead of duplicating the shared subtree indefinitely. Counts are omitted rather than approximated if an extreme profile reaches a defensive traversal ceiling.

PGN import/export preserves RAV paths, authored line labels, per-ply comments,
and numeric or symbolic annotation glyphs for signed-in repertoires.

Phase 3 (drills) is implemented: a "Drills" mode (toggle next to the explorer) that walks every saved repertoire line for the active color one at a time, accepts any saved move at a branch point (not just one "correct" answer), and tracks progress until every line has been drilled once. Wrong moves are classified by engine centipawn loss (objectively bad vs. just off-book), with progressively stronger hints on repeated attempts. Finishing a line pauses without auto-scrolling; View in explorer, Next/Finish, Restart, and Shuffle drills stay directly below the board. Desktop shows Analysis and Lichess statistics automatically, while phones use compact Analysis/Stats buttons. The sole post-drill engine review streams three Stockfish candidates during iterative deepening toward depth 24, so the eval bar and arrows appear before the final cacheable result; rank 1 drives the eval bar and calibrated verdict, while recurring moves across all candidates drive continuation arrows and support move-order observations. Signed-in users share the strongest compatible normalized-FEN result through PostgreSQL, while signed-out sessions reuse it in browser memory. A session ends with a perfect/failed summary and a "Retry failed" option.

A2 concrete position analysis is complete. It adds a public, versioned
normalized-FEN cache of deterministic material, pawn, file, activity, king, and
tactical facts. Post-drill Analysis includes legal-move before/after changes,
engine-backed mate/evaluation-swing warnings, and selectable evidence that
highlights exact board squares.

Both boards play distinct sound effects for a regular move, a capture, a check, and a checkmate; drills add corrective wrong-move feedback and a completion chime. They're synthesized in the browser with the Web Audio API rather than shipped as audio files, so there are no binary assets to license or download. A toggle in the header mutes them, persisted like the theme preference. Dark mode is the first-visit default; an explicit light or dark choice remains persisted.

Phase 4 (backend) is implemented: a Django + DRF + PostgreSQL backend (`backend/`) adds Google sign-in, optional post-sign-in Lichess OAuth linking, validated Chess.com public-username linking, server-side repertoire storage, a caching explorer/engine-eval proxy, and persistent drill statistics. Lichess never authenticates a Mainline account, while signed-out users may still paste a personal Lichess API token into the explorer; that token remains in browser `localStorage` and is used for direct Lichess requests. Chess.com linking stores no credentials and is not ownership verification because its generally available Published Data API has no OAuth flow. Signing in is optional — signed-out users can create reusable local opening modules and compose profiles in versioned `localStorage`, and an existing local repertoire is imported into the backend the first time you sign in. Signed-in users get the same Tournament/Blitz-style profile composition backed by the server, can choose one module as the editing target, inspect move provenance across merged overlays, and drill a composed profile from move one or a selected explorer position. The opening library has immutable JSON-backed releases split into official Mainline modules and community-published user modules, with anonymous read-only loading in the explorer; signing in additionally enables publishing owned modules, persistent profile pins, editable copies, and per-line gap filling. Anyone can generate a recommended coverage tree from the current explorer position and create a new personal module from its PGN lines; anonymous users may use their locally supplied Lichess token. Private phone access to the laptop-hosted development stack is wired through Tailscale. Mobile-first engineering and automated Android/iPhone-sized browser coverage are complete; a top-right phone menu consolidates repertoire color, profile/module management, sound, theme, and account controls. Only the hands-on Android/Tailscale acceptance matrix remains in [mobile-plan.md](mobile-plan.md). The remaining product roadmap stays in [AGENTS.md](AGENTS.md#development-roadmap).

The signed-in **My games** explorer can use Lichess, the linked Chess.com
username's cached monthly PGNs, or both sources combined.

Mainline sign-in uses Google OpenID Connect. Lichess OAuth is retained as an optional linked data source
rather than the primary account requirement.

The on-demand coverage dashboard uses a 95% practical full-coverage target,
weights its profile score by matching-game volume, and distinguishes fully
covered, partially covered, and no-data positions. Its highest-impact list
ranks positions by uncovered matching games adjusted for the repertoire side's
cached engine advantage, then opens each selected gap directly in Explorer.
Equal or worse positions keep their full exposure while already-winning
positions are discounted.

## Project layout

- `frontend/` — React + TypeScript + Vite app. See [frontend/README.md](frontend/README.md) for template-specific notes (this will likely be replaced with app-specific docs as the project grows).
- `backend/` — Django + DRF + PostgreSQL app (accounts/Lichess OAuth, repertoire persistence, explorer/engine-eval and MultiPV position-analysis caches, drill statistics). See [backend/README.md](backend/README.md) for setup and [backend/API_CONTRACT.md](backend/API_CONTRACT.md) for the endpoint contract.
- `openingtree/` — git submodule; a pre-existing React app used as a **reference implementation only** for Lichess/Chess.com game-history iteration and PGN parsing (see [AGENTS.md](AGENTS.md#inspiration-source-openingtree-submodule)). Not built or run directly as part of this app.
- `deployment-plan.md` — operating plan for private Tailscale development,
  a disposable free-Render invited alpha, and the paid Render production
  topology, release runbook, security/configuration contract, rollback, and
  launch gates.
- `mobile-plan.md` — completed mobile engineering record plus the physical-phone acceptance matrix.
- `position-analysis-plan.md` — phased cached end-of-drill analysis, recurring plans, and deterministic positional features.

## Getting started

Backend (see [backend/README.md](backend/README.md) for full setup, including the one-time database role/key creation):

```bash
cd backend
cp .env.example .env   # then fill in DJANGO_SECRET_KEY / TOKEN_ENCRYPTION_KEY, see backend/README.md
docker compose up -d   # optional disposable PostgreSQL on :5433
uv sync
uv run manage.py migrate
uv run manage.py seed_opening_templates  # Vienna, Sicilian, and Stonewall starter releases
uv run manage.py runserver
```

## Private phone access during development

Install Tailscale on this laptop and phone, sign both into the same Personal
tailnet, then run from the repository root:

```bash
./scripts/remote-dev
```

The command applies pending migrations, starts Django and Vite on loopback,
configures private tailnet HTTPS proxying with Tailscale Serve, verifies the
route, and prints the URL for the phone. The origin is reachable only inside
Tailscale's encrypted private network. Press Ctrl-C to stop both servers and disable
the proxy. PostgreSQL remains local and is never exposed. See
[deployment-plan.md](deployment-plan.md) for the verification checklist.

Before testing Google sign-in for the first time, follow the laptop-only
[authentication setup checklist](backend/README.md#one-time-google-and-email-sign-in-setup-for-tailscale-development).

The global-library candidate generator and the unfinished authentication rollout are summarized together in [current-work-handoff.md](current-work-handoff.md). Generator usage is documented in [backend/repertoire/OPENING_GENERATOR.md](backend/repertoire/OPENING_GENERATOR.md).

`remote-dev` owns ports 8000 (Django) and 5173 (Vite). Stop separately started
development servers before running it. The script checks both ports before
starting anything and reports the conflicting port and listener; Vite is run in
strict-port mode so it cannot silently move to 5174 and break the proxy.

On first use, Tailscale may require one administrator-approved operator setting:

```bash
sudo tailscale set --operator="$USER"
```

Run that once, then rerun `./scripts/remote-dev`. The wrapper configures
Tailscale Serve before starting either long-running app process, so an access
denial cannot leave a partial development stack behind.

## Invited alpha deployment

The `render-launch` branch configures one free Render Web Service and one free
Render Postgres database for a small, disposable invited alpha. Render runs
migrations and the idempotent starter-library seed before starting a single Gunicorn worker; the app exposes liveness
at `/api/v1/health/`, database readiness at `/api/v1/ready/`, and the alpha
privacy notice at `/privacy/`. Alpha data has no durability guarantee. See the
launch and expiry checklist in [deployment-plan.md](deployment-plan.md) before
sharing the service URL.

Frontend, in another terminal:

```bash
git submodule update --init --recursive
cd frontend
npm install
npm run dev
```

Browse to the Vite URL (http://localhost:5173), not directly to Django — its dev
server proxies `/api` to the backend, which keeps the session cookie first-party.
Sign in with Google from the header. Lichess is connected afterward; signed-out users can instead paste a personal token into the explorer panel (see
[AGENTS.md](AGENTS.md#data-sources)).

Other useful commands (run from `frontend/`):

```bash
npm run build     # type-check and build for production
npm run lint       # run oxlint
npm run test       # run the Vitest unit tests
npx playwright install chromium  # one-time browser download for end-to-end tests
npm run test:e2e   # run profile/line persistence, source-switch, and selected-drill browser tests
npm run preview    # preview a production build
```
