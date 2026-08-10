# opening-prep

A web app for building and drilling a personal chess opening repertoire, inspired by Chessly's drills mode and openingtree.com's player-stats explorer. See [AGENTS.md](AGENTS.md) for the full project reference (features, architecture decisions, and roadmap).

## Status

Phase 1 (opening explorer MVP) is implemented: move-by-move line browser (step through the line with the Back/Forward buttons or the ←/→ arrow keys), Lichess Opening Explorer stats (normalized-FEN/filter-keyed browser and PostgreSQL caches; requires a user-supplied token when signed out), and client-side Stockfish (WASM) evaluation with iterative deepening. Stockfish results are shared across explorer/drill consumers in memory and, when signed in, persisted by normalized FEN plus engine build so revisiting a position can skip analysis.

Phase 2 (repertoire builder) is implemented: a FEN-keyed repertoire tree per color, built directly into the explorer page — save/remove any played move via a toggle in the move list, browse saved continuations from the current position, and see which Lichess-explorer moves are already part of your prep.

PGN import/export preserves RAV paths, authored line labels, per-ply comments,
and numeric or symbolic annotation glyphs for signed-in repertoires.

Phase 3 (drills) is implemented: a "Drills" mode (toggle next to the explorer) that walks every saved repertoire line for the active color one at a time, accepts any saved move at a branch point (not just one "correct" answer), and tracks progress until every line has been drilled once. Wrong moves are classified by engine centipawn loss (objectively bad vs. just off-book), with progressively stronger hints (best-response line, then origin square, then origin+destination square) on repeated wrong attempts at the same position, plus a similar/transposed-position hint when a near-identical position elsewhere in the repertoire has the played move saved. Finishing a line pauses there for review, showing a calibrated Stockfish verdict, score/depth, principal variation, and orange best-move arrow next to the Lichess statistics for that position; up to three blue frequency-weighted arrows separately show common empirical continuations. A session ends with a perfect/failed summary and a "Retry failed" option.

Both boards play distinct sound effects for a regular move, a capture, a check, and a checkmate; drills add corrective wrong-move feedback and a completion chime. They're synthesized in the browser with the Web Audio API rather than shipped as audio files, so there are no binary assets to license or download. A toggle in the header mutes them, persisted like the theme preference.

Phase 4 (backend) is implemented: a Django + DRF + PostgreSQL backend (`backend/`) adds Lichess account sign-in (OAuth), server-side repertoire storage, a caching explorer/engine-eval proxy, and persistent drill statistics. Signing in is optional — signed-out users can create reusable local opening modules and compose profiles in versioned `localStorage` (alongside a personal Lichess token pasted into the explorer panel), and an existing local repertoire is imported into the backend the first time you sign in. Signed-in users get the same Tournament/Blitz-style profile composition backed by the server, can choose one module as the editing target, inspect move provenance across merged overlays, and drill a composed profile from move one or a selected explorer position. The global opening library has immutable JSON-backed releases with preview, read-only pin, editable-copy, curated starter content, validation, and per-line gap-fill flows. Private phone access to the laptop-hosted development stack is wired through Tailscale. Mobile-first engineering and automated Android/iPhone-sized browser coverage are complete; only the hands-on Android/Tailscale acceptance matrix remains in [mobile-plan.md](mobile-plan.md). The remaining product roadmap stays in [AGENTS.md](AGENTS.md#development-roadmap).

## Project layout

- `frontend/` — React + TypeScript + Vite app. See [frontend/README.md](frontend/README.md) for template-specific notes (this will likely be replaced with app-specific docs as the project grows).
- `backend/` — Django + DRF + PostgreSQL app (accounts/Lichess OAuth, repertoire persistence, explorer/engine-eval cache, drill statistics). See [backend/README.md](backend/README.md) for setup and [backend/API_CONTRACT.md](backend/API_CONTRACT.md) for the endpoint contract.
- `openingtree/` — git submodule; a pre-existing React app used as a **reference implementation only** for Lichess/Chess.com game-history iteration and PGN parsing (see [AGENTS.md](AGENTS.md#inspiration-source-openingtree-submodule)). Not built or run directly as part of this app.
- `deployment-plan.md` — operating plan for free, private Tailscale access from a phone to the laptop-hosted development app; managed production hosting and database backup/restore work are deferred.
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
configures private tailnet HTTP proxying with Tailscale Serve, verifies the
route, and prints the URL for the phone. This HTTP origin is reachable only
inside Tailscale's encrypted private network and avoids blocking development on
public TLS certificate issuance. Press Ctrl-C to stop both servers and disable
the proxy. PostgreSQL remains local and is never exposed. See
[deployment-plan.md](deployment-plan.md) for the verification checklist.

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

Frontend, in another terminal:

```bash
git submodule update --init --recursive
cd frontend
npm install
npm run dev
```

Browse to the Vite URL (http://localhost:5173), not directly to Django — its dev
server proxies `/api` to the backend, which keeps the session cookie first-party.
Sign in with Lichess from the header, or paste a personal Lichess API token into
the "Lichess explorer" panel to use the explorer signed-out (see
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
