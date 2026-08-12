# API contract

This document records the live backend/frontend interface. The original Phase 4
routes remain backward compatible; composable profiles, opening modules, global
releases, and selected-position drills extend that contract. Update this file
whenever an implemented request or response shape changes.

Everything is mounted under `/api/v1/`. The app-level `urls.py` includes already
exist in `opening_prep/urls.py`, so adding a route only means editing that app's
own `urls.py`.

## Conventions

- **Auth**: session cookie, set by a Google/email callback. DRF defaults to
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
  "user": { "id": 1, "username": "Chess-Player", "email": "player@example.com", "lichessUsername": "DrNykterstein", "chessComUsername": "hikaru" }
}
```
When signed out: `{"authenticated": false, "user": null}`.

### `GET /api/v1/auth/google/start/` and `google/callback/`
Browser redirects implementing Google's server-side authorization-code OpenID
Connect flow. Callback state and the verified Google identity are validated
before Django starts the Mainline session. A provider identity or verified
email already owned by a different account redirects with
`authError=account_conflict`; identities are never silently reassigned.

### `PUT /api/v1/auth/chess-com/`
Authenticated. Accepts `{"username":"hikaru"}`, validates it against
Chess.com's public player endpoint, and stores the canonical public username.
Returns the updated session user shape. A missing player is `400`; an upstream
failure/rate limit is `503`. This is not OAuth or proof of account ownership:
Chess.com's generally available Published Data API is read-only.

### `DELETE /api/v1/auth/chess-com/`
Authenticated. Removes the connected public username. `204 No Content`.

### `GET /api/v1/auth/lichess/start/`
Authenticated. Generates the PKCE `code_verifier` and `state`, stashes them in
the Django session, and **302s to Lichess**. Not an XHR endpoint — the browser
navigates to it. Accepts an optional `?next=` path (must be relative; reject
absolute URLs) recorded for the post-login redirect.

### `GET /api/v1/auth/lichess/callback/`
Authenticated. Handles `?code=&state=`, verifies `state` against the session,
exchanges the code at `{LICHESS_HOST}/api/token`, fetches the profile from
`{LICHESS_HOST}/api/account`, attaches or updates the current user's
`LichessAccount`, and **302s back to `FRONTEND_URL`** (plus the recorded `next`).
Lichess OAuth never creates or signs into a Mainline account.
On failure it redirects with `?authError=<slug>` rather than rendering an error
page. Access tokens are encrypted with `TOKEN_ENCRYPTION_KEY` before storage and
are never serialized to any response. When an identity belongs to a legacy
user record with no Google or verified-email sign-in, linking it merges that
record's durable repertoire and drill data into the current account. An
identity owned by another sign-in-capable Mainline account still redirects
with `authError=account_conflict` and preserves both accounts.

If a merge is available, the callback instead redirects with
`accountMerge=lichess` and stores an encrypted, ten-minute pending merge in the
authenticated session. `GET /api/v1/auth/lichess/merge/` previews the legacy
account's module, profile, drill-session, and publication counts. `POST`
confirms the transactional merge and returns the updated session user; `DELETE`
cancels it. Neither the callback nor the preview mutates either account.
Modules and profiles remain separate records; name collisions receive a
deterministic `(merged)` suffix rather than combining their contents.

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
[{ "id": 1, "name": "Default", "color": "white", "moveCount": 42, "lineCount": 8,
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
Returns the module's complete ordered line list. A module permits only one repertoire-side response per position. Conflicts return `409` with `code: "response_conflict"` and position/move details. The optional `conflictPolicy: "replace"` explicitly removes the previous response and its now-unreachable authored continuations before adding the submitted line; omission defaults to `"reject"`.

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

These routes are mounted at `/api/v1/opening-templates/`. Published templates are explicitly classified as `official` (Mainline-curated) or `community` (published by a user). Releases are immutable in both catalogs.

The list, release-detail, and candidate-generation routes are anonymous so signed-out users can load releases and generate personal trees. Profile attachment, publishing, copying, and gap filling remain authenticated mutations.

### `POST /api/v1/opening-templates/generate/`
Generates a recommended PGN tree from a supplied move prefix. It accepts a linked, locally supplied, or server Lichess token and never publishes automatically.

### `POST /api/v1/opening-templates/publish/`
With `{"moduleId": number, "changelog": string}`, snapshots an owned, non-empty personal module into the community catalog. Re-publishing the same module creates the next immutable version. Official status cannot be granted through this endpoint.

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
authored path in the owned, same-color module. Returns `{"added": number, "skipped": number, "conflicts": array}` and is idempotent. Lines that conflict with the selected module's repertoire response are skipped; copying the release creates a separate module that preserves those alternatives.

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

### `GET /api/v1/explorer/my-games/?fen=<fen>&color=<white|black>&moves=12&speeds=bullet,blitz&databases=lichess,chesscom`
**Authenticated only** — there's no anonymous path, since this always needs the
caller's own linked accounts. `databases` selects Lichess, Chess.com, or both
(the default). Lichess is a live proxy for its player-scoped
opening explorer (the signed-in user's own games), unlike the longer-lived shared cache on
`/explorer/stats/`. Completed results are cached per user for
`PLAYER_EXPLORER_CACHE_TTL_SECONDS`; partial `stillIndexing` snapshots are never
cached so polling continues to observe progress. `color` is the color the signed-in user played (matching
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

### `GET /api/v1/explorer/evals/?fen=<fen>&engineVersion=<build>`
Cached engine evaluation, or `404` when nothing is cached. Shape matches
`EngineEvaluation` minus the client-only `thinking`/`terminal` flags:
```json
{ "fen": "...", "engineVersion": "stockfish-18-lite-single", "depth": 22, "scoreType": "cp", "scoreValue": 31,
  "bestMoveUci": "e2e4", "pvUci": ["e2e4", "e7e5"] }
```

### `PUT /api/v1/explorer/evals/`
Upserts an evaluation computed by the client's Stockfish worker. **Keeps the
deepest result per normalized FEN and engine build**: a shallower submission for a position that already has a
deeper entry is accepted and ignored. Returns the stored (possibly pre-existing,
deeper) record.

### `GET /api/v1/explorer/position-analyses/?fen=<fen>&engineVersion=<build>&analysisProfile=drill-review-basic-v1`

Returns a cached versioned MultiPV review, or `404` when no compatible result
exists. Reads are authenticated but objective results are shared across users.

```json
{
  "fen": "...",
  "engineVersion": "stockfish-18-lite-single",
  "analysisProfile": "drill-review-basic-v1",
  "depth": 24,
  "multiPv": 3,
  "candidates": [
    {"rank": 1, "depth": 24, "scoreType": "cp", "scoreValue": 31,
     "bestMoveUci": "g8f6", "pvUci": ["g8f6", "g1f3", "d7d5"]}
  ],
  "recurringMoves": [
    {"uci": "d7d5", "san": "d5", "side": "black", "earliestPly": 1,
     "latestPly": 3, "lineCount": 2, "totalLines": 3,
     "timing": "prepared", "prerequisiteLines": [["g8f6", "g1f3"]],
     "immediateCandidateRank": null, "immediateCentipawnLoss": null}
  ],
  "updatedAt": "2026-08-10T12:00:00Z"
}
```

`scoreValue` is always from White's perspective. `earliestPly` and
`latestPly` are zero-based offsets within candidate PVs. Recurring moves are
deterministically derived evidence, not strategic prose. `timing` is `prepared`
when every occurrence follows other moves and `mixed` when the move is both an
immediate candidate and used later. `prerequisiteLines` are exact observed UCI
prefixes. `immediateCentipawnLoss` is present only when the top candidate and
the immediate candidate both have centipawn scores; mate scores are never
coerced into centipawns.

### `PUT /api/v1/explorer/position-analyses/`

Authenticated upload of a browser-computed review. The server validates the
FEN, supported profile, exactly 1–3 uniquely ranked candidates, numeric bounds,
and every UCI move by replaying each PV with `python-chess`. Candidate lines are
limited to 10 plies. Recurring-move evidence is recomputed server-side from the
validated candidates; client-supplied summaries or prose are not accepted.

Compatibility key: normalized FEN, engine build, and analysis profile. The
server keeps the strongest compatible result ordered by minimum candidate
depth, then candidate breadth, then total stored PV plies. A weaker upload is
accepted but returns the stronger stored row. `drill-review-basic-v1` means
Stockfish 18, MultiPV up to 3, target depth 24, and a 10-ply PV horizon.
Reads and writes share an authenticated 30-request-per-minute throttle, and
this profile accepts only the deployed `stockfish-18-lite-single` build.

### `GET /api/v1/explorer/position-features/?fen=<fen>`

Public, deterministic concrete board facts derived server-side from the
normalized FEN. Results are globally cached by normalized FEN and extractor
version; clients cannot upload facts or prose. The A2 extractor ships material,
pawn structure, open/semi-open files, development/mobility, forcing-move counts,
castling/check state, and conservative loose/contested/pinned/hanging-piece
evidence.

```json
{
  "fen": "...",
  "schemaVersion": 1,
  "extractorVersion": "concrete-v2",
  "facts": [
    {
      "id": "pawns:doubled_pawns:white:a4,a5",
      "category": "pawns",
      "kind": "doubled_pawns",
      "side": "white",
      "severity": "weakness",
      "confidence": "certain",
      "summary": "White has doubled pawns on the a-file.",
      "squares": ["a4", "a5"],
      "pieces": ["white pawn", "white pawn"],
      "evidence": {"file": "a", "count": 2}
    }
  ],
  "checksum": "<sha256>",
  "updatedAt": "2026-08-10T12:00:00Z"
}
```

Every fact has a stable identifier, calibrated severity/confidence, and exact
square/piece evidence. Missing facts are omitted rather than represented as
negative claims. Invalid FENs return `400`.

### `GET /api/v1/explorer/move-comparisons/?fen=<fen>&move=<uci>`

Public, deterministic comparison of concrete facts before and after one legal
move. The response includes normalized origin/result FENs, UCI and SAN labels,
complete `before` and `after` feature payloads, and exact `addedFacts` and
`removedFacts`. Invalid FEN/UCI or an illegal move returns `400`.

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
