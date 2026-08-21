"""
Tests for the caching/proxy logic in explorer_cache/cache.py. All outbound HTTP
is mocked with `responses` - this suite must never hit a live Lichess API.
"""

import threading
import time

import pytest
import requests
import responses
from django.db import connections
from django.utils import timezone

from accounts.models import User
from common.fen import normalize_fen
from explorer_cache import cache
from explorer_cache.models import EngineLineCache, PositionStatsCache

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


def _raw_response(white=10, draws=5, black=5, moves=None, opening=None):
    return {
        "white": white,
        "draws": draws,
        "black": black,
        "moves": moves
        if moves is not None
        else [{"san": "e4", "uci": "e2e4", "white": 10, "draws": 5, "black": 5}],
        "opening": opening if opening is not None else {"eco": "B00", "name": "King's Pawn"},
    }


@pytest.fixture
def user(db):
    return User.objects.create_user(username="alice", password="x")


@pytest.fixture(autouse=True)
def has_token(monkeypatch):
    """Every test in this module has a resolvable token unless a test overrides it."""
    monkeypatch.setattr(cache, "token_for_user", lambda user: "test-token")


@responses.activate
def test_cache_miss_then_hit(user, settings):
    responses.add(responses.GET, settings.LICHESS_EXPLORER_URL, json=_raw_response(), status=200)

    data = cache.get_or_fetch_stats(START_FEN, 12, user)
    assert data["totalGames"] == 20
    assert data["moves"] == [
        {"san": "e4", "uci": "e2e4", "white": 10, "draws": 5, "black": 5, "totalGames": 20}
    ]
    assert data["opening"] == {"eco": "B00", "name": "King's Pawn"}
    assert len(responses.calls) == 1

    # Second call within the TTL should be served from the cache.
    data_again = cache.get_or_fetch_stats(START_FEN, 12, user)
    assert data_again == data
    assert len(responses.calls) == 1
    assert PositionStatsCache.objects.count() == 1


@responses.activate
def test_expired_entry_is_refetched(user, settings):
    responses.add(
        responses.GET,
        settings.LICHESS_EXPLORER_URL,
        json=_raw_response(white=1, draws=0, black=0),
        status=200,
    )
    cache.get_or_fetch_stats(START_FEN, 12, user)

    entry = PositionStatsCache.objects.get()
    entry.expires_at = timezone.now() - timezone.timedelta(seconds=1)
    entry.save()

    cache.get_or_fetch_stats(START_FEN, 12, user)
    assert len(responses.calls) == 2
    # The expired row is replaced in place, not duplicated.
    assert PositionStatsCache.objects.count() == 1


@responses.activate
def test_since_until_ratings_speeds_are_forwarded_to_upstream(user, settings):
    responses.add(responses.GET, settings.LICHESS_EXPLORER_URL, json=_raw_response(), status=200)

    cache.get_or_fetch_stats(
        START_FEN, 12, user, since="2020-01", until="2021-06", ratings="1600,2000", speeds="blitz,rapid"
    )

    request_url = responses.calls[0].request.url
    assert "since=2020-01" in request_url
    assert "until=2021-06" in request_url
    assert "ratings=1600%2C2000" in request_url
    assert "speeds=blitz%2Crapid" in request_url


@responses.activate
def test_different_filters_get_distinct_cache_entries(user, settings):
    responses.add(
        responses.GET,
        settings.LICHESS_EXPLORER_URL,
        json=_raw_response(white=1, draws=0, black=0),
        status=200,
    )
    responses.add(
        responses.GET,
        settings.LICHESS_EXPLORER_URL,
        json=_raw_response(white=2, draws=0, black=0),
        status=200,
    )

    unfiltered = cache.get_or_fetch_stats(START_FEN, 12, user)
    filtered = cache.get_or_fetch_stats(START_FEN, 12, user, ratings="1600")

    assert unfiltered["totalGames"] == 1
    assert filtered["totalGames"] == 2
    assert PositionStatsCache.objects.count() == 2
    assert len(responses.calls) == 2


@responses.activate
def test_differing_params_get_distinct_cache_entries(user, settings):
    responses.add(
        responses.GET,
        settings.LICHESS_EXPLORER_URL,
        json=_raw_response(white=1, draws=0, black=0),
        status=200,
    )
    responses.add(
        responses.GET,
        settings.LICHESS_EXPLORER_URL,
        json=_raw_response(white=2, draws=0, black=0),
        status=200,
    )

    data_12 = cache.get_or_fetch_stats(START_FEN, 12, user)
    data_5 = cache.get_or_fetch_stats(START_FEN, 5, user)

    assert data_12["totalGames"] == 1
    assert data_5["totalGames"] == 2
    assert PositionStatsCache.objects.count() == 2
    assert len(responses.calls) == 2


def test_no_token_raises_token_required(user, monkeypatch):
    monkeypatch.setattr(cache, "token_for_user", lambda user: None)
    with pytest.raises(cache.TokenRequired):
        cache.get_or_fetch_stats(START_FEN, 12, user)


@responses.activate
def test_upstream_rate_limit_is_surfaced_with_retry_after(user, settings):
    responses.add(responses.GET, settings.LICHESS_EXPLORER_URL, status=429, headers={"Retry-After": "30"})

    with pytest.raises(cache.UpstreamRateLimited) as exc_info:
        cache.get_or_fetch_stats(START_FEN, 12, user)
    assert exc_info.value.retry_after == "30"
    # A rate-limited response must not be cached as if it were real data.
    assert PositionStatsCache.objects.count() == 0


@responses.activate
def test_expired_entry_is_served_when_refresh_is_rate_limited(user, settings):
    responses.add(responses.GET, settings.LICHESS_EXPLORER_URL, json=_raw_response(), status=200)
    expected = cache.get_or_fetch_stats(START_FEN, 12, user)
    entry = PositionStatsCache.objects.get()
    entry.expires_at = timezone.now() - timezone.timedelta(seconds=1)
    entry.save()
    responses.add(
        responses.GET,
        settings.LICHESS_EXPLORER_URL,
        status=429,
        headers={"Retry-After": "30"},
    )

    assert cache.get_or_fetch_stats(START_FEN, 12, user) == expected
    assert len(responses.calls) == 2


@responses.activate
def test_expired_entry_is_served_when_refresh_is_unavailable(user, settings):
    responses.add(responses.GET, settings.LICHESS_EXPLORER_URL, json=_raw_response(), status=200)
    expected = cache.get_or_fetch_stats(START_FEN, 12, user)
    entry = PositionStatsCache.objects.get()
    entry.expires_at = timezone.now() - timezone.timedelta(seconds=1)
    entry.save()
    responses.add(responses.GET, settings.LICHESS_EXPLORER_URL, status=503)

    assert cache.get_or_fetch_stats(START_FEN, 12, user) == expected
    assert len(responses.calls) == 2


@responses.activate
def test_upstream_5xx_raises_unavailable_not_500(user, settings):
    responses.add(responses.GET, settings.LICHESS_EXPLORER_URL, status=503)
    with pytest.raises(cache.UpstreamUnavailable):
        cache.get_or_fetch_stats(START_FEN, 12, user)


@responses.activate
def test_upstream_timeout_raises_unavailable_not_500(user, settings):
    responses.add(
        responses.GET,
        settings.LICHESS_EXPLORER_URL,
        body=requests.exceptions.ConnectTimeout("upstream took too long"),
    )
    with pytest.raises(cache.UpstreamUnavailable):
        cache.get_or_fetch_stats(START_FEN, 12, user)


@pytest.mark.django_db(transaction=True)
def test_concurrent_requests_for_the_same_key_single_flight(monkeypatch):
    """
    Two callers racing for the same not-yet-cached key must not both hit
    upstream - see the locking discussion in cache.get_or_fetch_stats. Uses
    `transaction=True` so the two threads get their own DB connections and the
    Postgres advisory lock actually has something to serialize.
    """
    user = User.objects.create_user(username="bob", password="x")
    monkeypatch.setattr(cache, "token_for_user", lambda u: "test-token")

    call_count = 0
    count_lock = threading.Lock()
    first_call_started = threading.Event()

    def slow_fetch_upstream(normalized_fen, moves, token, since=None, until=None, ratings=None, speeds=None):
        nonlocal call_count
        with count_lock:
            call_count += 1
        first_call_started.set()
        # Long enough that the second thread's advisory-lock wait (and its
        # subsequent cache re-check) reliably lands after this one commits.
        time.sleep(0.3)
        return _raw_response(white=1, draws=0, black=0)

    monkeypatch.setattr(cache, "_fetch_upstream", slow_fetch_upstream)

    results: list[dict] = []
    errors: list[Exception] = []

    def worker():
        try:
            results.append(cache.get_or_fetch_stats(START_FEN, 12, user))
        except Exception as exc:  # noqa: BLE001 - surfaced via `errors` for the assertion below
            errors.append(exc)
        finally:
            # Each thread opens its own DB connection (Django connections are
            # thread-local); leaving it open past the thread's lifetime is what
            # makes pytest-django's test-database teardown warn about the
            # database still being "accessed by other users".
            connections.close_all()

    t1 = threading.Thread(target=worker)
    t2 = threading.Thread(target=worker)
    t1.start()
    assert first_call_started.wait(timeout=2), "first thread never reached the upstream call"
    t2.start()
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert not errors
    assert call_count == 1
    assert len(results) == 2
    assert results[0] == results[1]


def test_upsert_engine_line_keeps_deepest(db):
    row, created = cache.upsert_engine_line(
        START_FEN,
        "stockfish-test",
        depth=10,
        score_type="cp",
        score_value=20,
        best_move_uci="e2e4",
        pv_uci=["e2e4"],
    )
    assert created is True
    assert row.depth == 10

    # A shallower submission for the same position is accepted (no error) and ignored.
    kept, replaced = cache.upsert_engine_line(
        START_FEN,
        "stockfish-test",
        depth=5,
        score_type="cp",
        score_value=999,
        best_move_uci="d2d4",
        pv_uci=["d2d4"],
    )
    assert replaced is False
    assert kept.depth == 10
    assert kept.score_value == 20

    # A deeper submission does replace it.
    deeper, replaced = cache.upsert_engine_line(
        START_FEN,
        "stockfish-test",
        depth=15,
        score_type="mate",
        score_value=1,
        best_move_uci="e2e4",
        pv_uci=["e2e4", "e7e5"],
    )
    assert replaced is True
    assert deeper.depth == 15
    assert deeper.score_type == "mate"

    assert EngineLineCache.objects.count() == 1


def test_get_cached_eval_normalizes_the_lookup_fen(db):
    cache.upsert_engine_line(
        START_FEN, "stockfish-test", depth=10, score_type="cp", score_value=5, best_move_uci=None, pv_uci=[]
    )

    assert cache.get_cached_eval(START_FEN, "stockfish-test") is not None
    assert cache.get_cached_eval(normalize_fen(START_FEN), "stockfish-test") is not None
    assert cache.get_cached_eval(START_FEN, "another-engine") is None


def test_get_cached_eval_missing_returns_none(db):
    assert cache.get_cached_eval(START_FEN, "stockfish-test") is None


def test_engine_builds_have_independent_cache_entries(db):
    cache.upsert_engine_line(
        START_FEN,
        "stockfish-a",
        depth=10,
        score_type="cp",
        score_value=5,
        best_move_uci=None,
        pv_uci=[],
    )
    cache.upsert_engine_line(
        START_FEN,
        "stockfish-b",
        depth=12,
        score_type="cp",
        score_value=8,
        best_move_uci=None,
        pv_uci=[],
    )

    assert cache.get_cached_eval(START_FEN, "stockfish-a").depth == 10
    assert cache.get_cached_eval(START_FEN, "stockfish-b").depth == 12
    assert EngineLineCache.objects.count() == 2
