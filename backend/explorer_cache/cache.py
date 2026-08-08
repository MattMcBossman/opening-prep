"""
Core caching/proxy logic for the Lichess explorer and the client-submitted
engine-evaluation cache. Kept separate from views.py so the HTTP layer stays a
thin translation to/from DRF request/response objects, and so the concurrency
handling can be unit-tested without going through a request/response cycle.
"""

import hashlib
from datetime import timedelta

import requests
from django.conf import settings
from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from common.fen import denormalize_fen, normalize_fen

from .lichess_token import token_for_user
from .models import EngineLineCache, PositionStatsCache

UPSTREAM_TIMEOUT_SECONDS = 8


class TokenRequired(Exception):
    """No Lichess token is available to make this request upstream."""


class UpstreamRateLimited(Exception):
    """Lichess replied 429; `retry_after` is its `Retry-After` header, if any."""

    def __init__(self, retry_after: str | None):
        self.retry_after = retry_after


class UpstreamUnavailable(Exception):
    """Lichess timed out, errored, or returned something we can't parse."""


def params_key_for(moves: int) -> str:
    """
    Stable hash of every explorer query option that changes the upstream
    response. `moves` is the only one today; the rating-band filter planned in
    AGENTS.md adds fields to the hashed string later, and every *existing*
    cache row stays correctly scoped when that happens because a differently-
    shaped input hashes to a different key rather than colliding with the
    unfiltered data already cached under the old key shape.
    """
    raw = f"moves={moves}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def _advisory_lock_id(key: str) -> int:
    """Deterministic signed 64-bit id for `pg_advisory_xact_lock` (an opaque bigint)."""
    digest = hashlib.sha256(key.encode()).digest()[:8]
    return int.from_bytes(digest, byteorder="big", signed=True)


def _fresh_entry(fen: str, params_key: str) -> PositionStatsCache | None:
    entry = PositionStatsCache.objects.filter(
        source=PositionStatsCache.SOURCE_LICHESS, fen=fen, params_key=params_key
    ).first()
    return entry if entry and not entry.is_expired else None


def get_or_fetch_stats(fen: str, moves: int, user) -> dict:
    """
    Returns the transformed `ExplorerResponse` dict for `fen`, from cache when
    fresh or freshly fetched from Lichess otherwise. Raises `TokenRequired`,
    `UpstreamRateLimited`, or `UpstreamUnavailable` for the view to translate
    into the appropriate HTTP response.

    Concurrency: without a lock, two requests racing for the same not-yet-
    cached key would both call upstream and both write. Serialized here with
    `pg_advisory_xact_lock`, a Postgres transaction-scoped advisory lock keyed
    on a hash of `(fen, params_key)` - chosen over Django's cache framework
    because the default cache backend (LocMemCache; see settings) is
    per-process and wouldn't serialize requests handled by different
    production worker processes. The lock is only taken on the slow path (miss
    or expiry), never on a cache hit, and needs no manual release: it's held
    for the lifetime of the transaction and Postgres drops it when that ends,
    including on an exception.
    """
    normalized = normalize_fen(fen)
    key = params_key_for(moves)

    cached = _fresh_entry(normalized, key)
    if cached is not None:
        return _to_explorer_response(cached.response)

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [_advisory_lock_id(f"{normalized}:{key}")])

        # Re-check now that we hold the lock: whoever held it before us may
        # have just populated the cache while we were waiting.
        cached = _fresh_entry(normalized, key)
        if cached is not None:
            return _to_explorer_response(cached.response)

        token = token_for_user(user)
        if not token:
            raise TokenRequired()

        raw = _fetch_upstream(normalized, moves, token)

        entry, _ = PositionStatsCache.objects.update_or_create(
            source=PositionStatsCache.SOURCE_LICHESS,
            fen=normalized,
            params_key=key,
            defaults={
                "response": raw,
                "expires_at": timezone.now() + timedelta(seconds=settings.EXPLORER_CACHE_TTL_SECONDS),
            },
        )
        return _to_explorer_response(entry.response)


def _fetch_upstream(normalized_fen: str, moves: int, token: str) -> dict:
    # Lichess's own move-counter fields don't affect the response - it only
    # cares about board/side-to-move/castling/en-passant - so ply 0 (fullmove 1,
    # halfmove 0) is a harmless default when `normalized_fen` has no move-count
    # fields of its own to restore.
    upstream_fen = denormalize_fen(normalized_fen, ply=0)
    try:
        response = requests.get(
            settings.LICHESS_EXPLORER_URL,
            params={"fen": upstream_fen, "moves": moves, "topGames": 0, "recentGames": 0},
            headers={"Authorization": f"Bearer {token}"},
            timeout=UPSTREAM_TIMEOUT_SECONDS,
        )
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


def _to_explorer_response(raw: dict) -> dict:
    """
    Reshapes a raw Lichess payload into `ExplorerResponse`
    (`frontend/src/types.ts`), mirroring the transform `fetchLichessExplorer`
    does client-side today (`frontend/src/lib/lichessExplorer.ts`) so the
    shape means the same thing regardless of which path produced it.
    """
    moves = []
    for m in raw.get("moves") or []:
        white = m.get("white") or 0
        draws = m.get("draws") or 0
        black = m.get("black") or 0
        moves.append(
            {
                "san": m.get("san"),
                "uci": m.get("uci"),
                "white": white,
                "draws": draws,
                "black": black,
                "totalGames": white + draws + black,
            }
        )
    opening = raw.get("opening")
    return {
        "totalGames": (raw.get("white") or 0) + (raw.get("draws") or 0) + (raw.get("black") or 0),
        "moves": moves,
        "opening": {"eco": opening["eco"], "name": opening["name"]} if opening else None,
    }


def get_cached_eval(fen: str) -> EngineLineCache | None:
    return EngineLineCache.objects.filter(fen=normalize_fen(fen)).first()


def _apply_submission(
    row: EngineLineCache,
    depth: int,
    score_type: str,
    score_value: int,
    best_move_uci: str | None,
    pv_uci: list[str],
) -> None:
    row.depth = depth
    row.score_type = score_type
    row.score_value = score_value
    row.best_move_uci = best_move_uci
    row.pv_uci = pv_uci
    row.save()


def upsert_engine_line(
    fen: str,
    depth: int,
    score_type: str,
    score_value: int,
    best_move_uci: str | None,
    pv_uci: list[str],
) -> tuple[EngineLineCache, bool]:
    """
    Stores `fen`'s evaluation, keeping whichever of the new submission and any
    existing row is deeper - mirrors the client's own iterative-deepening cache
    (`frontend/src/hooks/useEngineEval.ts`), which likewise only ever wants the
    best (deepest) result it has seen for a position. Returns
    `(stored_record, stored_the_new_submission)`; the second is `False` when a
    shallower submission was silently kept out.

    `select_for_update` serializes concurrent submissions for the same FEN so
    two near-simultaneous depth-N and depth-N+1 results can't race and leave
    the shallower one stored. The very first insert for a FEN can't be locked
    that way (there's no row yet), so a losing `IntegrityError` on the unique
    `fen` constraint is treated as "someone else just created it" and retried
    as a locked update instead.
    """
    normalized = normalize_fen(fen)
    with transaction.atomic():
        existing = EngineLineCache.objects.select_for_update().filter(fen=normalized).first()
        if existing:
            if existing.depth >= depth:
                return existing, False
            _apply_submission(existing, depth, score_type, score_value, best_move_uci, pv_uci)
            return existing, True

        try:
            with transaction.atomic():
                created = EngineLineCache.objects.create(
                    fen=normalized,
                    depth=depth,
                    score_type=score_type,
                    score_value=score_value,
                    best_move_uci=best_move_uci,
                    pv_uci=pv_uci,
                )
            return created, True
        except IntegrityError:
            existing = EngineLineCache.objects.select_for_update().get(fen=normalized)
            if existing.depth >= depth:
                return existing, False
            _apply_submission(existing, depth, score_type, score_value, best_move_uci, pv_uci)
            return existing, True
