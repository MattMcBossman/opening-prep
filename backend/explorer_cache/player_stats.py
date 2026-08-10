"""
Live proxy for Lichess's player-scoped Opening Explorer
(https://explorer.lichess.org/player), which aggregates one signed-in user's
own games rather than the whole Lichess database. Deliberately uncached,
unlike the DB-cached `/lichess` proxy in cache.py - see the "Personal
game-data explorer" plan: this is the signed-in user's own data, queried
fresh every time rather than shared/cached across users.

The endpoint streams ND-JSON while Lichess indexes the player's games in the
background: intermediate lines carry a `queuePosition` that (in principle)
counts down to done, and a line without one is the finished result. In
practice this can take a while (or apparently never fully resolve for some
accounts - see
https://lichess.org/forum/lichess-feedback/lichess-api-player-games-endpoint-is-non-functional),
so the proxy returns the first current snapshot promptly, flagged as
`stillIndexing`, and lets the browser poll for later snapshots rather than
holding one request open indefinitely.
"""

import json

import requests

from accounts.tokens import get_lichess_access_token, get_lichess_username
from common.fen import denormalize_fen, normalize_fen

from .cache import TokenRequired, UpstreamRateLimited, UpstreamUnavailable
from .response_shape import to_explorer_response

UPSTREAM_TIMEOUT_SECONDS = 8
PLAYER_EXPLORER_URL = "https://explorer.lichess.org/player"


def fetch_player_stats(
    user,
    fen: str,
    moves: int,
    color: str,
    since: str | None = None,
    until: str | None = None,
    speeds: str | None = None,
) -> dict:
    """
    Returns an `ExplorerResponse`-shaped dict (see response_shape.py) built
    from `user`'s own games played as `color`, from `fen`. Adds
    `stillIndexing: True` when Lichess hadn't finished processing within
    `STREAM_BUDGET_SECONDS` - the caller still gets a real (if possibly
    incomplete) result rather than an error.

    `since`/`until` (Lichess's own "YYYY-MM" format) are optional and
    forwarded to Lichess unchanged - see `explorer_cache/serializers.py`'s
    `validate_month`.

    Raises `TokenRequired` (no linked Lichess account, or a decrypt failure),
    `UpstreamRateLimited`, or `UpstreamUnavailable` - reusing the same
    exceptions `cache.py` uses so the view can translate both proxies'
    failures identically (see explorer_cache/views.py).
    """
    token = get_lichess_access_token(user)
    username = get_lichess_username(user)
    if not token or not username:
        raise TokenRequired()

    upstream_fen = denormalize_fen(normalize_fen(fen), ply=0)
    params = {
        "player": username,
        "color": color,
        "fen": upstream_fen,
        "moves": moves,
        "topGames": 0,
        "recentGames": 0,
    }
    if since:
        params["since"] = since
    if until:
        params["until"] = until
    if speeds:
        params["speeds"] = speeds

    try:
        response = requests.get(
            PLAYER_EXPLORER_URL,
            params=params,
            headers={"Authorization": f"Bearer {token}"},
            timeout=UPSTREAM_TIMEOUT_SECONDS,
            stream=True,
        )
    except requests.RequestException as exc:
        raise UpstreamUnavailable() from exc

    if response.status_code == 429:
        raise UpstreamRateLimited(response.headers.get("Retry-After"))
    if not response.ok:
        raise UpstreamUnavailable()

    snapshot = _read_ndjson_snapshot(response)
    if snapshot is None:
        raise UpstreamUnavailable()

    result = to_explorer_response(snapshot)
    if "queuePosition" in snapshot:
        result["stillIndexing"] = True
        # This is the only progress signal Lichess exposes. Keep it separate
        # from totalGames: that count is for the selected position and may be
        # partial, not the number of account games indexed globally.
        result["queuePosition"] = snapshot["queuePosition"]
    return result


def _read_ndjson_snapshot(response: requests.Response) -> dict | None:
    """
    Return the first parseable snapshot from Lichess's stream. Lichess sends
    the current aggregate immediately, then may hold the connection open while
    indexing more games. Returning that first snapshot lets the browser show a
    real game count during indexing; bounded frontend polling requests later
    snapshots instead of one Django request hiding progress for ~15 seconds.
    """
    try:
        for line in response.iter_lines(decode_unicode=True):
            if not line:
                continue
            try:
                parsed = json.loads(line)
            except ValueError:
                continue
            return parsed
    except requests.RequestException:
        pass
    finally:
        response.close()
    return None
