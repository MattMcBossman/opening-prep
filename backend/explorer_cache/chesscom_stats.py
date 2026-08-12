"""Position statistics derived from a linked Chess.com user's public PGNs."""

import io
import hashlib
import time
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

import chess.pgn
import requests
from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from accounts.models import ChessComAccount
from common.fen import normalize_fen

from .cache import TokenRequired, UpstreamRateLimited, UpstreamUnavailable
from .models import ChessComArchiveCache, ChessComGamePosition, PlayerStatsCache

REQUEST_TIMEOUT = 12
USER_AGENT = "Mainline chess opening preparation"
SOURCE_SPEEDS = {
    "bullet": {"bullet"},
    "blitz": {"blitz"},
    "rapid": {"rapid"},
    "classical": set(),
    "correspondence": {"daily"},
    "ultraBullet": {"bullet"},
}
INDEX_BUDGET_SECONDS = 0.8


def _get_json(url: str) -> dict:
    try:
        response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT)
    except requests.RequestException as exc:
        raise UpstreamUnavailable() from exc
    if response.status_code == 429:
        raise UpstreamRateLimited(response.headers.get("Retry-After"))
    if not response.ok:
        raise UpstreamUnavailable()
    try:
        return response.json()
    except ValueError as exc:
        raise UpstreamUnavailable() from exc


def _cached_payload(username: str, key: str, url: str, ttl: timedelta) -> dict:
    cached = ChessComArchiveCache.objects.filter(username__iexact=username, archive_key=key).first()
    if cached and not cached.is_expired:
        return cached.response
    payload = _get_json(url)
    changed = cached is None or cached.response != payload
    ChessComArchiveCache.objects.update_or_create(
        username=username.lower(),
        archive_key=key,
        defaults={
            "response": payload,
            "expires_at": timezone.now() + ttl,
            **({"indexed_at": None} if changed and key != "index" else {}),
        },
    )
    return payload


def _archive_key(url: str) -> str | None:
    parts = urlparse(url).path.rstrip("/").split("/")
    if len(parts) < 2 or not parts[-2].isdigit() or not parts[-1].isdigit():
        return None
    return f"{int(parts[-2]):04d}-{int(parts[-1]):02d}"


def _selected_archives(username: str, since: str | None, until: str | None) -> list[tuple[str, str]]:
    base = settings.CHESS_COM_API_URL.rstrip("/")
    index = _cached_payload(
        username,
        "index",
        f"{base}/player/{username}/games/archives",
        timedelta(minutes=10),
    )
    selected = []
    for url in index.get("archives", []):
        key = _archive_key(url)
        if key and (not since or key >= since) and (not until or key <= until):
            selected.append((key, url))
    return selected


def _result_counts(result: str) -> tuple[int, int, int]:
    if result == "1-0":
        return 1, 0, 0
    if result == "0-1":
        return 0, 0, 1
    return 0, 1, 0


def _index_archive(username: str, key: str, url: str, current_month: str) -> None:
    ttl = timedelta(minutes=10) if key == current_month else timedelta(days=30)
    payload = _cached_payload(username, key, url, ttl)
    cache_row = ChessComArchiveCache.objects.get(username__iexact=username, archive_key=key)
    if cache_row.indexed_at:
        return

    positions = []
    for sequence, raw in enumerate(payload.get("games", [])):
        if raw.get("rules") != "chess":
            continue
        white_name = raw.get("white", {}).get("username", "")
        black_name = raw.get("black", {}).get("username", "")
        if white_name.lower() == username.lower():
            player_color = "white"
        elif black_name.lower() == username.lower():
            player_color = "black"
        else:
            continue
        ended = raw.get("end_time")
        if not ended:
            continue
        played_at = datetime.fromtimestamp(ended, UTC)
        game_key = str(raw.get("url") or raw.get("uuid") or f"{key}:{sequence}")[:255]
        try:
            game = chess.pgn.read_game(io.StringIO(raw.get("pgn", "")))
            if not game:
                continue
            white, draws, black = _result_counts(game.headers.get("Result", "*"))
            board = game.board()
            for ply, move in enumerate(game.mainline_moves()):
                positions.append(
                    ChessComGamePosition(
                        username=username.lower(),
                        archive_key=key,
                        game_key=game_key,
                        ply=ply,
                        player_color=player_color,
                        time_class=raw.get("time_class", ""),
                        played_at=played_at,
                        origin_fen=normalize_fen(board.fen()),
                        san=board.san(move),
                        uci=move.uci(),
                        white=white,
                        draws=draws,
                        black=black,
                    )
                )
                board.push(move)
        except (ValueError, TypeError):
            continue

    with transaction.atomic():
        ChessComGamePosition.objects.filter(username__iexact=username, archive_key=key).delete()
        ChessComGamePosition.objects.bulk_create(positions, batch_size=2000)
        cache_row.indexed_at = timezone.now()
        cache_row.save(update_fields=["indexed_at"])


def _advance_index(username: str, archives: list[tuple[str, str]]) -> bool:
    """Index at least one archive, then yield after a short request budget."""
    indexed_keys = set(
        ChessComArchiveCache.objects.filter(
            username__iexact=username,
            archive_key__in=[key for key, _url in archives],
            indexed_at__isnull=False,
        ).values_list("archive_key", flat=True)
    )
    pending = [(key, url) for key, url in reversed(archives) if key not in indexed_keys]
    started = time.monotonic()
    current_month = timezone.now().strftime("%Y-%m")
    processed = 0
    for key, url in pending:
        _index_archive(username, key, url, current_month)
        processed += 1
        if processed >= 1 and time.monotonic() - started >= INDEX_BUDGET_SECONDS:
            break
    return processed < len(pending)


def fetch_chesscom_stats(
    user,
    fen: str,
    moves: int,
    color: str,
    since: str | None = None,
    until: str | None = None,
    speeds: str | None = None,
) -> dict:
    account = ChessComAccount.objects.filter(user=user).first()
    if not account:
        raise TokenRequired()
    normalized = normalize_fen(fen)
    speed_values = set(speeds.split(",")) if speeds else set()
    chesscom_speeds = set().union(*(SOURCE_SPEEDS.get(value, set()) for value in speed_values))
    raw_key = f"source=chesscom-index-v1&moves={moves}&since={since or ''}&until={until or ''}&speeds={speeds or ''}"
    params_key = hashlib.sha256(raw_key.encode()).hexdigest()[:32]
    cached = PlayerStatsCache.objects.filter(
        user=user, fen=normalized, color=color, params_key=params_key
    ).first()
    if cached and not cached.is_expired:
        return cached.response

    archives = _selected_archives(account.username, since, until)
    still_indexing = _advance_index(account.username, archives)
    query = ChessComGamePosition.objects.filter(
        username__iexact=account.username,
        player_color=color,
        origin_fen=normalized,
        archive_key__in=[key for key, _url in archives],
    )
    if since:
        query = query.filter(played_at__gte=datetime.strptime(since, "%Y-%m").replace(tzinfo=UTC))
    if until:
        year, month = map(int, until.split("-"))
        next_month = datetime(year + (month == 12), 1 if month == 12 else month + 1, 1, tzinfo=UTC)
        query = query.filter(played_at__lt=next_month)
    if speed_values:
        query = query.filter(time_class__in=chesscom_speeds)
    result_moves = list(
        query.values("san", "uci")
        .annotate(white=Sum("white"), draws=Sum("draws"), black=Sum("black"))
    )
    for row in result_moves:
        row["totalGames"] = row["white"] + row["draws"] + row["black"]
    result_moves.sort(key=lambda row: (-row["totalGames"], row["san"]))
    total_games = sum(row["totalGames"] for row in result_moves)
    result_moves = result_moves[:moves]
    result = {
        "totalGames": total_games,
        "moves": result_moves,
        "opening": None,
        **({"stillIndexing": True} if still_indexing else {}),
    }
    if not still_indexing:
        PlayerStatsCache.objects.update_or_create(
            user=user,
            fen=normalized,
            color=color,
            params_key=params_key,
            defaults={
                "response": result,
                "expires_at": timezone.now()
                + timedelta(seconds=settings.PLAYER_EXPLORER_CACHE_TTL_SECONDS),
            },
        )
    return result
