# API contract

This document records the live backend/frontend interface. The original Phase 4
routes remain backward compatible; composable profiles, opening modules, global
releases, and selected-position drills extend that contract. Update this file
whenever an implemented request or response shape changes.

Everything is mounted under `/api/v1/`. The app-level `urls.py` includes already
exist in `opening_prep/urls.py`, so adding a route only means editing that app's
own `urls.py`.

## Conventions

- **Auth**: session cookie, set by the OAuth callback. DRF defaults to
  `IsAuthenticated`; endpoints usable anonymously opt out explicitly.
- **CSRF**: unsafe methods require the `X-CSRFToken` header. The frontend obtains
  the cookie from `GET /api/v1/auth/session/`.
- **FENs**: every FEN crossing this boundary is **normalized** (board, side to
  move, castling, en passant — no halfmove clock or fullmove number), matching
  `normalizeFen` in `frontend/src/lib/chessUtils.ts` and `normalize_fen` in
  `backend/common/fen.py`. The one exception is the explorer proxy, which accepts
  either and denormalizes before calling upstream.
- **Colors**: the strings `"white"` and `"black"`, matching `RepertoireColor`.
- **Errors**: DRF defaults — `{"detail": "..."}` with an appropriate status.
  Validation errors are per-field objects.
- **Timestamps**: ISO 8601 UTC.

## Accounts — `accounts/urls.py`

### `GET /api/v1/auth/session/`
Anonymous-safe. Returns the current session state and ensures a CSRF cookie is
set. This is the app's bootstrap call.
```json
{
  "authenticated": true,
  "user": { "id": 1, "username": "DrNykterstein", "lichessUsername": "DrNykterstein" }
}
```
When signed out: `{"authenticated": false, "user": null}`.

### `GET /api/v1/auth/lichess/start/`
Anonymous-safe. Generates the PKCE `code_verifier` and `state`, stashes them in
the Django session, and **302s to Lichess**. Not an XHR endpoint — the browser
navigates to it. Accepts an optional `?next=` path (must be relative; reject
absolute URLs) recorded for the post-login redirect.

### `GET /api/v1/auth/lichess/callback/`
Anonymous-safe. Handles `?code=&state=`, verifies `state` against the session,
exchanges the code at `{LICHESS_HOST}/api/token`, fetches the profile from
`{LICHESS_HOST}/api/account`, creates-or-updates the `User` and `LichessAccount`,
logs the user in, and **302s back to `FRONTEND_URL`** (plus the recorded `next`).
On failure it redirects with `?authError=<slug>` rather than rendering an error
page. Access tokens are encrypted with `TOKEN_ENCRYPTION_KEY` before storage and
are never serialized to any response.

### `POST /api/v1/auth/logout/`
Flushes the session. `204 No Content`.

## Repertoire — `repertoire/urls.py`

A `Repertoire` is the compatibility name for a reusable personal opening module
covering one color. Profiles compose any number of personal modules and pinned
global releases; the signed-in UI selects one personal module as its write target
and merges the other enabled components as read overlays.

### `GET/POST /api/v1/repertoires/profiles/`
Lists or creates the caller's named composed profiles. Each response includes
the profile's ordered personal modules with move/line counts and enabled state.

### `GET/PATCH/DELETE /api/v1/repertoires/profiles/{id}/`
Fetches, renames/describes, or deletes an owned profile. Deleting a profile does
not delete its reusable modules.

### `POST/DELETE /api/v1/repertoires/profiles/{id}/modules/`
Adds, updates, or removes a personal module membership. POST accepts
`{"moduleId": 1, "sortOrder": 0, "enabled": true}`; DELETE accepts
`{"moduleId": 1}`. Both the profile and module must belong to the caller.

### `POST/DELETE /api/v1/repertoires/profiles/{id}/template-releases/`
Pins, updates, or removes a published global release in a profile. POST accepts
`{"templateReleaseId": 7, "sortOrder": 0, "enabled": true}`; DELETE accepts
`{"templateReleaseId": 7}`. Pins are read-only and remain fixed to that version.

### `GET /api/v1/repertoires/`
```json
[{ "id": 1, "name": "Default", "color": "white", "moveCount": 42,
   "createdAt": "...", "updatedAt": "..." }]
```

### `POST /api/v1/repertoires/`
Body `{"name": "...", "color": "white"}` → the created object.

### `GET /api/v1/repertoires/{id}/tree/`
The whole tree, in exactly the shape `RepertoireTree` already has on the client,
so `useRepertoire` needs no reshaping:
```json
{
  "rnbqkbnr/... w KQkq -": [
    { "san": "e4", "uci": "e2e4", "resultingFen": "rnbqkbnr/... b KQkq e3" }
  ]
}
```

### `GET /api/v1/repertoires/{id}/lines/`
Returns explicit, stable-UUID root-to-leaf move orders for the module, including
their ordered steps. During the compatibility phase these lines are synchronized
from the FEN graph after every existing add/remove/import mutation. A later
line-authoring endpoint below can make authored lines the mutation source of
truth for new writes.

### `POST /api/v1/repertoires/{id}/lines/`
Adds a complete legal path beginning at the standard initial position. Exact
duplicates and prefixes of existing lines are idempotent; extending a terminal
prefix replaces that shorter line. Body:
```json
{"label": "Main line", "source": "manual", "steps": [
  {"originFen": "...", "san": "e4", "uci": "e2e4", "resultingFen": "..."}
]}
```
Returns the module's complete ordered line list.

The body may also contain `annotations`, a list of
`{"ply": number, "comment"?: string, "nags"?: number[]}` entries. Ply values
must be unique and within the submitted path. The line-list response returns
these annotations for PGN comment/NAG round-tripping.

### `DELETE /api/v1/repertoires/{id}/lines/{line UUID}/`
Deletes an explicit line and prunes graph edges that are no longer referenced by
another line. Returns `204 No Content`.

### `POST /api/v1/repertoires/{id}/moves/`
Adds one or more edges **atomically**, mirroring the client's cascade-save (which
saves every earlier ply in the line, opponent replies included).
```json
{ "moves": [ { "originFen": "...", "san": "e4", "uci": "e2e4", "resultingFen": "..." } ] }
```
Adding an edge that already exists is a no-op, not an error, so the client can
replay a cascade safely. Returns the updated tree. `400` if a FEN is unparseable
or a move is illegal in its origin position.

### `DELETE /api/v1/repertoires/{id}/moves/`
Body `{"originFen": "...", "uci": "e2e4"}`. Applies the **exact cascade semantics
of `useRepertoire.ts (18-56)`**:
1. Remove the edge.
2. Delete the subtree beneath its resulting position — **unless** that position is
   still reachable from some other surviving edge (a transposition), in which case
   the shared subtree survives.
3. If the origin position now has no saved moves and it is a position where the
   repertoire owner is to move, delete every edge that leads *into* it: an
   opponent reply with no prepared response is no longer useful. This recurses
   exactly one step — an opponent reply's own parent is never deleted this way.
   The mirror case (one of the owner's moves with nothing prepped under it yet) is
   a normal state and must not be pruned.

Returns the updated tree. This behaviour is the single most important thing to get
right in this phase; port the Vitest cases.

### `POST /api/v1/repertoires/import/`
One-time migration of a `localStorage` repertoire. Body is the two trees as the
client already stores them:
```json
{ "white": { "<fen>": [ ... ] }, "black": { "<fen>": [ ... ] } }
```
Idempotent: existing edges are skipped, not duplicated. Returns
`{"white": {"imported": 12, "skipped": 3}, "black": {...}}`.

## Global opening library — `repertoire/global_urls.py`

These routes are mounted at `/api/v1/opening-templates/`. Template creation and
release publishing are admin-only; the public API only discovers and uses
published releases.

### `GET /api/v1/opening-templates/`
Lists published templates with metadata for their latest immutable release.

### `GET /api/v1/opening-templates/{slug}/releases/{version}/`
Returns release metadata plus its normalized-FEN `tree` object and explicit
`lines` JSON snapshot. Releases cannot be edited after creation.

### `POST /api/v1/opening-templates/{slug}/releases/{version}/copy/`
Copies a release into an editable personal module while retaining the module
response's `source_release` provenance id. Accepts optional `name` and `profileId`; when a
profile is supplied, the new module is attached to it. Returns the module with
`201 Created`.

### `POST /api/v1/opening-templates/{slug}/releases/{version}/copy-missing/`
With `{"moduleId": number}`, adds only release paths not already covered by an
authored path in the owned, same-color module. Returns
`{"added": number, "skipped": number}` and is idempotent.

## Explorer cache — `explorer_cache/urls.py`

### `GET /api/v1/explorer/stats/?fen=<fen>&moves=12`
**Anonymous-safe**, throttled under the `explorer` scope. Returns cached Lichess
data or fetches it upstream. The response is the already-normalized shape the
frontend uses today (`ExplorerResponse` in `frontend/src/types.ts`), so
`lichessExplorer.ts` keeps its return type:
```json
{
  "totalGames": 12345,
  "moves": [ { "san": "e4", "uci": "e2e4", "white": 100, "draws": 20, "black": 80,
               "totalGames": 200 } ],
  "opening": { "eco": "B90", "name": "Sicilian Defense: Najdorf Variation" }
}
```
`opening` may be `null`. Cache key is `(source, normalized fen, params hash)`;
TTL is `EXPLORER_CACHE_TTL_SECONDS`. The token used upstream is the signed-in
user's stored Lichess token; anonymous callers fall back to a server token if one
is configured, and otherwise get `401` with a `detail` explaining that sign-in is
required — the frontend then keeps using its existing direct-to-Lichess path.
Upstream `429` is surfaced as `429` with `Retry-After` passed through. Concurrent
requests for the same key should not produce duplicate upstream calls.

### `GET /api/v1/explorer/my-games/?fen=<fen>&color=<white|black>&moves=12&speeds=bullet,blitz`
**Authenticated only** — there's no anonymous path, since this always needs the
caller's own linked Lichess account. Live proxy for Lichess's player-scoped
opening explorer (the signed-in user's own games), **never cached** unlike
`/explorer/stats/`. `color` is the color the signed-in user played (matching
the app's White/Black repertoire toggle), not whose turn it is at `fen`.
Optional `since`/`until` month filters and comma-separated `speeds`
(`ultraBullet`, `bullet`, `blitz`, `rapid`, `classical`, `correspondence`)
are forwarded to Lichess's player explorer.
Response shape is `ExplorerResponse` plus optional `stillIndexing: true` and
`queuePosition` fields while Lichess reports background indexing. `totalGames`
is the number of matching games currently available for the selected position;
it is not a global account-import progress count. While Lichess is still
processing the account, this is a best-effort partial result, not an error. The
proxy returns the latest promptly available snapshot (including an immediately
following terminal line) and the frontend polls through unchanged partial
snapshots for updates. `queuePosition` is diagnostic and is not presented as a
game-count progress indicator. `401` when
no Lichess account is linked.

### `GET /api/v1/explorer/evals/?fen=<fen>`
Cached engine evaluation, or `404` when nothing is cached. Shape matches
`EngineEvaluation` minus the client-only `thinking`/`terminal` flags:
```json
{ "fen": "...", "depth": 22, "scoreType": "cp", "scoreValue": 31,
  "bestMoveUci": "e2e4", "pvUci": ["e2e4", "e7e5"] }
```

### `PUT /api/v1/explorer/evals/`
Upserts an evaluation computed by the client's Stockfish worker. **Keeps the
deepest result per FEN**: a shallower submission for a position that already has a
deeper entry is accepted and ignored. Returns the stored (possibly pre-existing,
deeper) record.

## Drills — `drills/urls.py`

All authenticated. The client remains the source of truth for running a session;
these endpoints record what happened for later analysis.

### `POST /api/v1/drills/sessions/`
Creates a session from one or more personal modules and/or pinned global
releases. The singular `repertoireId` remains accepted for old clients.
```json
{
  "repertoireIds": [1, 2],
  "templateReleaseIds": [7],
  "isRetryPass": false,
  "startMode": "selected_position",
  "selectedFen": "...",
  "selectedPly": 4,
  "prefixUci": ["e2e4", "e7e5", "b1c3", "g8f6"]
}
```
At least one source is required. `startMode` is `beginning` or
`selected_position`; the latter requires `selectedFen`. Returns
`{"id": 7, "startedAt": "..."}`. Source join rows and launch context snapshot
the session independently of later profile edits.

### `POST /api/v1/drills/sessions/{id}/attempts/`
Accepts a batch, so the client can flush periodically rather than per move:
```json
{ "attempts": [
  { "originFen": "...", "playedUci": "e2e4", "isCorrect": false,
    "attemptNumber": 2, "cpLoss": 120, "isBad": true, "lineId": "e2e4 e7e5" }
] }
```
`cpLoss`/`isBad` are optional (they only exist once the engine comparison
resolves, and not at all for correct moves). `204 No Content`.

### `POST /api/v1/drills/sessions/{id}/finish/`
```json
{ "results": [ { "lineId": "e2e4 e7e5 g1f3", "outcome": "perfect" } ] }
```
Marks the session finished and stores the per-line outcomes. Returns the session
summary.

### `GET /api/v1/drills/sessions/`
Recent sessions with counts: `[{"id": 7, "startedAt": "...", "finishedAt": "...",
"isRetryPass": false, "perfect": 8, "failed": 2}]`.

### `GET /api/v1/drills/stats/?repertoire=<id>`
Per-position weakness aggregates computed from the raw attempts — the input a
future spaced-repetition scheduler will read:
```json
[ { "originFen": "...", "attempts": 9, "mistakes": 4, "lastSeenAt": "..." } ]
```
Sorted by mistake rate descending.

The more detailed domain and compatibility decisions live in
[`../profile-modules-plan.md`](../profile-modules-plan.md).
