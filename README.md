# opening-prep

A web app for building and drilling a personal chess opening repertoire, inspired by Chessly's drills mode and openingtree.com's player-stats explorer. See [AGENTS.md](AGENTS.md) for the full project reference (features, architecture decisions, and roadmap).

## Status

Phase 1 (opening explorer MVP) is implemented: move-by-move line browser, Lichess Opening Explorer stats (cached by FEN, requires a user-supplied Lichess API token), and client-side Stockfish (WASM) evaluation with iterative deepening.

Phase 2 (repertoire builder) is implemented: a FEN-keyed repertoire tree per color, built directly into the explorer page — save/remove any played move via a toggle in the move list, browse saved continuations from the current position, and see which Lichess-explorer moves are already part of your prep. Drills, player-data import, and gap-detection phases are not yet started — see the roadmap in [AGENTS.md](AGENTS.md#development-roadmap).

There is no backend yet; everything currently runs client-side in the `frontend/` app, including repertoire storage (`localStorage`).

## Project layout

- `frontend/` — React + TypeScript + Vite app. See [frontend/README.md](frontend/README.md) for template-specific notes (this will likely be replaced with app-specific docs as the project grows).
- `openingtree/` — git submodule; a pre-existing React app used as a **reference implementation only** for Lichess/Chess.com game-history iteration and PGN parsing (see [AGENTS.md](AGENTS.md#inspiration-source-openingtree-submodule)). Not built or run directly as part of this app.

## Getting started

```bash
git submodule update --init --recursive
cd frontend
npm install
npm run dev
```

Open the app and paste a personal Lichess API token into the "Lichess explorer" panel — Opening Explorer stats require it (see [AGENTS.md](AGENTS.md#data-sources)).

Other useful commands (run from `frontend/`):

```bash
npm run build     # type-check and build for production
npm run lint       # run oxlint
npm run preview    # preview a production build
```
