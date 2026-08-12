"""
Proxy for Lichess's player-scoped Opening Explorer
(https://explorer.lichess.org/player), which aggregates one signed-in user's
own games rather than the whole Lichess database. Terminal results receive a
short per-user cache; partial indexing snapshots remain live so polling can
observe progress.

The endpoint streams ND-JSON while Lichess indexes the player's games in the
background: intermediate lines carry a `queuePosition` that (in principle)
counts down to done, and a line without one is the finished result. In
practice this can take a while (or apparently never fully resolve for some
accounts - see
https://lichess.org/forum/lichess-feedback/lichess-api-player-games-endpoint-is-non-functional),
so the proxy returns the latest promptly available snapshot, flagged as
`stillIndexing` when necessary, and lets the browser poll for later snapshots rather than
holding one request open indefinitely.
"""

import hashlib
import json
from datetime import timedelta

import requests
from django.conf import settings
from django.utils import timezone

from accounts.tokens import get_lichess_access_token, get_lichess_username
from common.fen import denormalize_fen, normalize_fen

from .cache import TokenRequired, UpstreamRateLimited, UpstreamUnavailable
from .chesscom_stats import fetch_chesscom_stats
from .metrics import cache_event
from .models import PlayerStatsCache
from .response_shape import to_explorer_response

UPSTREAM_CONNECT_TIMEOUT_SECONDS = 8
# After receiving a partial ND-JSON snapshot, briefly wait for another line.
# Lichess often sends the terminal line immediately afterward; returning only
# the first line made completed indexing look permanently queued. Keep this
# short so genuinely queued requests still return useful partial data promptly.
UPSTREAM_READ_TIMEOUT_SECONDS = 2
PLAYER_EXPLORER_URL = "https://explorer.lichess.org/player"


def fetch_combined_player_stats(
    user,
    fen: str,
    moves: int,
    color: str,
    databases: str = "lichess,chesscom",
    **filters,
) -> dict:
    """Fetch selected personal-game sources and sum matching continuation rows."""
    selected = [value for value in databases.split(",") if value]
    results = []
    missing = 0
    for source in selected:
        try:
            if source == "lichess":
                results.append(fetch_player_stats(user, fen, moves, color, **filters))
            elif source == "chesscom":
                results.append(fetch_chesscom_stats(user, fen, moves, color, **filters))
        except TokenRequired:
            missing += 1
    if not results and missing:
        raise TokenRequired()

    rows = {}
    for result in results:
        for move in result.get("moves", []):
            row = rows.setdefault(
                move["uci"],
                {"san": move["san"], "uci": move["uci"], "white": 0, "draws": 0, "black": 0},
            )
            for outcome in ("white", "draws", "black"):
                row[outcome] += move.get(outcome, 0)
    combined_moves = []
    for row in rows.values():
        row["totalGames"] = row["white"] + row["draws"] + row["black"]
        combined_moves.append(row)
    combined_moves.sort(key=lambda row: (-row["totalGames"], row["san"]))
    combined = {
        "totalGames": sum(result.get("totalGames", 0) for result in results),
        "moves": combined_moves[:moves],
        "opening": next((result.get("opening") for result in results if result.get("opening")), None),
    }
    indexing = next((result for result in results if result.get("stillIndexing")), None)
    if indexing:
        combined["stillIndexing"] = True
        if "queuePosition" in indexing:
            combined["queuePosition"] = indexing["queuePosition"]
    return combined


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
    normalized_fen = normalize_fen(fen)
    raw_key = f"moves={moves}&since={since or ''}&until={until or ''}&speeds={speeds or ''}"
    params_key = hashlib.sha256(raw_key.encode()).hexdigest()[:32]
    cached = PlayerStatsCache.objects.filter(
        user=user, fen=normalized_fen, color=color, params_key=params_key
    ).first()
    if cached and not cached.is_expired:
        cache_event("player_explorer", "hit", user_id=user.pk)
        return cached.response
    cache_event("player_explorer", "miss", user_id=user.pk)

    token = get_lichess_access_token(user)
    username = get_lichess_username(user)
    if not token or not username:
        raise TokenRequired()

    upstream_fen = denormalize_fen(normalized_fen, ply=0)
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
            timeout=(UPSTREAM_CONNECT_TIMEOUT_SECONDS, UPSTREAM_READ_TIMEOUT_SECONDS),
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
        cache_event("player_explorer", "partial_not_cached", user_id=user.pk)
    else:
        PlayerStatsCache.objects.update_or_create(
            user=user,
            fen=normalized_fen,
            color=color,
            params_key=params_key,
            defaults={
                "response": result,
                "expires_at": timezone.now() + timedelta(seconds=settings.PLAYER_EXPLORER_CACHE_TTL_SECONDS),
            },
        )
        cache_event("player_explorer", "upstream_fetch_cached", user_id=user.pk)
    return result


def _read_ndjson_snapshot(response: requests.Response) -> dict | None:
    """
    Return the latest promptly available snapshot from Lichess's stream. A line
    without `queuePosition` is terminal and returns immediately. After a queued
    line, wait only for the short response read timeout: this catches a terminal
    line already following it without hiding partial progress behind a long
    request while Lichess continues background indexing.
    """
    snapshot = None
    try:
        for line in response.iter_lines(chunk_size=1, decode_unicode=True):
            if not line:
                continue
            try:
                parsed = json.loads(line)
            except ValueError:
                continue
            snapshot = parsed
            if "queuePosition" not in parsed:
                return parsed
    except requests.RequestException:
        pass
    finally:
        response.close()
    return snapshot
