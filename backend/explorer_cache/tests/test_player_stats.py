"""
Tests for explorer_cache/player_stats.py - the live (uncached) proxy for
Lichess's player-scoped opening explorer. All outbound HTTP is mocked with
`responses`; this suite must never hit a live Lichess API.
"""

import json

import pytest
import requests
import responses

from accounts.models import LichessAccount, User
from explorer_cache import cache, player_stats

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


@pytest.fixture
def user(db):
    user = User.objects.create_user(username="alice", password="x")
    account = LichessAccount(user=user, lichess_id="1", lichess_username="alice")
    account.access_token = "test-token"
    account.save()
    return user


def _ndjson(*objects) -> str:
    return "\n".join(json.dumps(o) for o in objects) + "\n"


@responses.activate
def test_returns_final_line_once_queue_position_clears(user):
    responses.add(
        responses.GET,
        player_stats.PLAYER_EXPLORER_URL,
        body=_ndjson(
            {"white": 1, "draws": 0, "black": 0, "moves": [], "queuePosition": 5},
            {"white": 10, "draws": 2, "black": 3, "moves": [{"san": "e4", "uci": "e2e4", "white": 10}]},
        ),
        status=200,
    )

    data = player_stats.fetch_player_stats(user, START_FEN, 12, "white")

    assert data["totalGames"] == 15
    assert data["moves"] == [
        {"san": "e4", "uci": "e2e4", "white": 10, "draws": 0, "black": 0, "totalGames": 10}
    ]
    assert "stillIndexing" not in data


@responses.activate
def test_flags_still_indexing_when_the_time_budget_expires(user, monkeypatch):
    monkeypatch.setattr(player_stats, "STREAM_BUDGET_SECONDS", 0)
    responses.add(
        responses.GET,
        player_stats.PLAYER_EXPLORER_URL,
        body=_ndjson(
            {"white": 1, "draws": 0, "black": 0, "moves": [], "queuePosition": 90},
            {"white": 2, "draws": 0, "black": 0, "moves": [], "queuePosition": 80},
        ),
        status=200,
    )

    data = player_stats.fetch_player_stats(user, START_FEN, 12, "white")

    assert data["stillIndexing"] is True
    # Stops after the first line once the (already-expired) budget is checked,
    # rather than draining the whole stream.
    assert data["totalGames"] == 1


@responses.activate
def test_skips_blank_and_unparseable_lines(user):
    responses.add(
        responses.GET,
        player_stats.PLAYER_EXPLORER_URL,
        body="\nnot json\n" + _ndjson({"white": 4, "draws": 0, "black": 0, "moves": []}),
        status=200,
    )

    data = player_stats.fetch_player_stats(user, START_FEN, 12, "white")
    assert data["totalGames"] == 4


@responses.activate
def test_since_until_are_forwarded_to_upstream(user):
    responses.add(
        responses.GET,
        player_stats.PLAYER_EXPLORER_URL,
        body=_ndjson({"white": 1, "draws": 0, "black": 0, "moves": []}),
        status=200,
    )

    player_stats.fetch_player_stats(user, START_FEN, 12, "white", since="2020-01", until="2021-06")

    request_url = responses.calls[0].request.url
    assert "since=2020-01" in request_url
    assert "until=2021-06" in request_url


def test_no_linked_account_raises_token_required(db):
    user = User.objects.create_user(username="no-lichess")
    with pytest.raises(cache.TokenRequired):
        player_stats.fetch_player_stats(user, START_FEN, 12, "white")


@responses.activate
def test_upstream_rate_limit_is_surfaced_with_retry_after(user):
    responses.add(responses.GET, player_stats.PLAYER_EXPLORER_URL, status=429, headers={"Retry-After": "30"})

    with pytest.raises(cache.UpstreamRateLimited) as exc_info:
        player_stats.fetch_player_stats(user, START_FEN, 12, "white")
    assert exc_info.value.retry_after == "30"


@responses.activate
def test_upstream_5xx_raises_unavailable_not_500(user):
    responses.add(responses.GET, player_stats.PLAYER_EXPLORER_URL, status=503)
    with pytest.raises(cache.UpstreamUnavailable):
        player_stats.fetch_player_stats(user, START_FEN, 12, "white")


@responses.activate
def test_connection_error_raises_unavailable_not_500(user):
    responses.add(
        responses.GET,
        player_stats.PLAYER_EXPLORER_URL,
        body=requests.exceptions.ConnectTimeout("upstream took too long"),
    )
    with pytest.raises(cache.UpstreamUnavailable):
        player_stats.fetch_player_stats(user, START_FEN, 12, "white")


@responses.activate
def test_no_parseable_lines_at_all_raises_unavailable(user):
    responses.add(responses.GET, player_stats.PLAYER_EXPLORER_URL, body="\n\n", status=200)
    with pytest.raises(cache.UpstreamUnavailable):
        player_stats.fetch_player_stats(user, START_FEN, 12, "white")
