"""Streaming personal-game exports for the browser-side opening index."""

import json
from datetime import UTC, datetime

import requests
from django.conf import settings
from django.http import StreamingHttpResponse

from accounts.models import ChessComAccount
from accounts.tokens import get_lichess_access_token, get_lichess_username

from .cache import TokenRequired, UpstreamRateLimited, UpstreamUnavailable

REQUEST_TIMEOUT = (8, 30)
USER_AGENT = "Mainline chess opening preparation"


def _raise_for_upstream(response) -> None:
    if response.status_code == 429:
        retry_after = response.headers.get("Retry-After")
        try:
            retry_after = str(max(90, int(retry_after or 0)))
        except ValueError:
            retry_after = "90"
        raise UpstreamRateLimited(retry_after)
    if not response.ok:
        raise UpstreamUnavailable()


def stream_lichess_games(user, since_ms: int | None = None) -> StreamingHttpResponse:
    token = get_lichess_access_token(user)
    username = get_lichess_username(user)
    if not token or not username:
        raise TokenRequired()
    params = {
        "moves": "true",
        "pgnInJson": "true",
        "clocks": "false",
        "evals": "false",
        # Lichess may otherwise cap a user export. A complete first snapshot is
        # required before the browser can safely switch to timestamp updates.
        "max": 100_000,
    }
    if since_ms:
        params["since"] = since_ms
    try:
        upstream = requests.get(
            f"https://lichess.org/api/games/user/{username}",
            params=params,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/x-ndjson"},
            timeout=REQUEST_TIMEOUT,
            stream=True,
        )
    except requests.RequestException as exc:
        raise UpstreamUnavailable() from exc
    _raise_for_upstream(upstream)

    def body():
        pending = b""
        try:
            for chunk in upstream.iter_content(chunk_size=64 * 1024):
                pending += chunk
                lines = pending.split(b"\n")
                pending = lines.pop()
                for line in lines:
                    if line.strip():
                        game = json.loads(line)
                        game["mainlineUsername"] = username
                        yield json.dumps(game, separators=(",", ":")).encode() + b"\n"
            if pending.strip():
                game = json.loads(pending)
                game["mainlineUsername"] = username
                yield json.dumps(game, separators=(",", ":")).encode() + b"\n"
        finally:
            upstream.close()

    return StreamingHttpResponse(body(), content_type="application/x-ndjson")


def _month_key(epoch_ms: int) -> str:
    return datetime.fromtimestamp(epoch_ms / 1000, UTC).strftime("%Y-%m")


def stream_chesscom_games(user, since_ms: int | None = None) -> StreamingHttpResponse:
    account = ChessComAccount.objects.filter(user=user).first()
    if not account:
        raise TokenRequired()
    base = settings.CHESS_COM_API_URL.rstrip("/")
    headers = {"User-Agent": USER_AGENT}
    try:
        index_response = requests.get(
            f"{base}/player/{account.username}/games/archives", headers=headers, timeout=REQUEST_TIMEOUT
        )
    except requests.RequestException as exc:
        raise UpstreamUnavailable() from exc
    _raise_for_upstream(index_response)
    urls = index_response.json().get("archives", [])
    if since_ms:
        earliest = _month_key(since_ms)
        urls = [
            url
            for url in urls
            if url.rstrip("/").rsplit("/", 2)[-2]
            + "-"
            + url.rstrip("/").rsplit("/", 1)[-1]
            >= earliest
        ]

    def body():
        for url in urls:
            try:
                response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
                _raise_for_upstream(response)
                for game in response.json().get("games", []):
                    game["mainlineUsername"] = account.username
                    yield json.dumps(game, separators=(",", ":")).encode() + b"\n"
            except (requests.RequestException, ValueError):
                continue

    return StreamingHttpResponse(body(), content_type="application/x-ndjson")
