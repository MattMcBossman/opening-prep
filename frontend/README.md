# Mainline frontend

React 19 + TypeScript + Vite. The frontend provides the responsive Explorer,
module authoring/management, personal-game browser index, and drills. See the
repository [README](../README.md) for setup and [ROADMAP](../ROADMAP.md) for
unfinished work.

## Commands

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
npm run test:e2e
```

The Vite development server proxies `/api` to Django on port 8000. Browse via
Vite (`http://localhost:5173`) so session cookies remain first-party. Run
`npm run setup:engine` if the Stockfish asset needs to be recopied from the
installed package.

Playwright requires a one-time Chromium installation:

```bash
npx playwright install chromium
```

## Layout

- `src/components/` — Explorer, drill, and management presentation.
- `src/hooks/` — game, repertoire, explorer, engine, auth, and persistence state.
- `src/lib/` — chess/repertoire logic, API clients, PGN support, and caches.
- `src/workers/` — browser-side personal-game parsing/indexing work.
- `src/audio/` — synthesized Web Audio cues.
- `e2e/` — Playwright phone/desktop regression flows.

The `openingtree/` repository is reference material only; no frontend code is
imported from its React 16 application.
