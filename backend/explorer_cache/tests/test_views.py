"""API-level tests for the explorer_cache endpoints. See API_CONTRACT.md."""

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from explorer_cache import cache, views
from explorer_cache.models import EngineLineCache

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="alice", password="x")


# --- /explorer/stats/ ------------------------------------------------------


def test_stats_invalid_fen_is_rejected_before_any_upstream_call(api_client, monkeypatch):
    called = False

    def fail_if_called(*args, **kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr(views.cache, "get_or_fetch_stats", fail_if_called)

    response = api_client.get("/api/v1/explorer/stats/", {"fen": "not a fen"})
    assert response.status_code == 400
    assert not called


def test_stats_no_token_returns_401_with_detail(api_client, monkeypatch):
    monkeypatch.setattr(
        views.cache, "get_or_fetch_stats", lambda *a, **k: (_ for _ in ()).throw(cache.TokenRequired())
    )

    response = api_client.get("/api/v1/explorer/stats/", {"fen": START_FEN})
    assert response.status_code == 401
    assert "detail" in response.data


def test_stats_rate_limited_passes_through_status_and_retry_after(api_client, monkeypatch):
    monkeypatch.setattr(
        views.cache,
        "get_or_fetch_stats",
        lambda *a, **k: (_ for _ in ()).throw(cache.UpstreamRateLimited(retry_after="17")),
    )

    response = api_client.get("/api/v1/explorer/stats/", {"fen": START_FEN})
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "17"


def test_stats_upstream_unavailable_returns_502_not_500(api_client, monkeypatch):
    monkeypatch.setattr(
        views.cache, "get_or_fetch_stats", lambda *a, **k: (_ for _ in ()).throw(cache.UpstreamUnavailable())
    )

    response = api_client.get("/api/v1/explorer/stats/", {"fen": START_FEN})
    assert response.status_code == 502


def test_stats_success_is_anonymous_safe_and_matches_explorer_response_shape(api_client, monkeypatch):
    canned = {
        "totalGames": 20,
        "moves": [{"san": "e4", "uci": "e2e4", "white": 10, "draws": 5, "black": 5, "totalGames": 20}],
        "opening": {"eco": "B00", "name": "King's Pawn"},
    }
    monkeypatch.setattr(views.cache, "get_or_fetch_stats", lambda *a, **k: canned)

    response = api_client.get("/api/v1/explorer/stats/", {"fen": START_FEN, "moves": 12})
    assert response.status_code == 200
    assert response.data == canned


def test_stats_rejects_malformed_since(api_client):
    response = api_client.get("/api/v1/explorer/stats/", {"fen": START_FEN, "since": "not-a-month"})
    assert response.status_code == 400


def test_stats_rejects_unknown_rating_band(api_client):
    response = api_client.get("/api/v1/explorer/stats/", {"fen": START_FEN, "ratings": "1600,9999"})
    assert response.status_code == 400


def test_stats_rejects_unknown_speed(api_client):
    response = api_client.get("/api/v1/explorer/stats/", {"fen": START_FEN, "speeds": "warp-speed"})
    assert response.status_code == 400


def test_stats_forwards_valid_filters(api_client, monkeypatch):
    captured = {}

    def fake_get_or_fetch_stats(fen, moves, user, **kwargs):
        captured.update(kwargs)
        return {"totalGames": 0, "moves": [], "opening": None}

    monkeypatch.setattr(views.cache, "get_or_fetch_stats", fake_get_or_fetch_stats)

    response = api_client.get(
        "/api/v1/explorer/stats/",
        {"fen": START_FEN, "since": "2020-01", "until": "2021-06", "ratings": "1600,2000", "speeds": "blitz"},
    )
    assert response.status_code == 200
    assert captured == {"since": "2020-01", "until": "2021-06", "ratings": "1600,2000", "speeds": "blitz"}


# --- /explorer/evals/ -------------------------------------------------------


def test_evals_get_requires_authentication(api_client):
    # DRF returns 403, not 401, here: with only SessionAuthentication configured
    # (see settings.py) there's no WWW-Authenticate challenge to offer, and DRF
    # falls back to 403 for an unauthenticated request in that case.
    response = api_client.get(
        "/api/v1/explorer/evals/", {"fen": START_FEN, "engineVersion": "stockfish-test"}
    )
    assert response.status_code == 403


def test_evals_put_requires_authentication(api_client):
    response = api_client.put(
        "/api/v1/explorer/evals/",
        {
            "fen": START_FEN,
            "engineVersion": "stockfish-test",
            "depth": 10,
            "scoreType": "cp",
            "scoreValue": 5,
        },
        format="json",
    )
    assert response.status_code == 403


def test_evals_get_missing_returns_404(api_client, user):
    api_client.force_authenticate(user=user)
    response = api_client.get(
        "/api/v1/explorer/evals/", {"fen": START_FEN, "engineVersion": "stockfish-test"}
    )
    assert response.status_code == 404


def test_evals_put_then_get_round_trips(api_client, user):
    api_client.force_authenticate(user=user)
    body = {
        "fen": START_FEN,
        "engineVersion": "stockfish-test",
        "depth": 18,
        "scoreType": "cp",
        "scoreValue": 34,
        "bestMoveUci": "e2e4",
        "pvUci": ["e2e4", "e7e5"],
    }

    put_response = api_client.put("/api/v1/explorer/evals/", body, format="json")
    assert put_response.status_code == 200
    assert put_response.data["depth"] == 18
    assert put_response.data["bestMoveUci"] == "e2e4"
    assert put_response.data["pvUci"] == ["e2e4", "e7e5"]

    get_response = api_client.get(
        "/api/v1/explorer/evals/", {"fen": START_FEN, "engineVersion": "stockfish-test"}
    )
    assert get_response.status_code == 200
    assert get_response.data["depth"] == 18
    assert EngineLineCache.objects.count() == 1


def test_evals_put_keeps_deepest_across_requests(api_client, user):
    api_client.force_authenticate(user=user)
    deep_body = {
        "fen": START_FEN,
        "engineVersion": "stockfish-test",
        "depth": 20,
        "scoreType": "cp",
        "scoreValue": 10,
        "pvUci": [],
    }
    shallow_body = {
        "fen": START_FEN,
        "engineVersion": "stockfish-test",
        "depth": 3,
        "scoreType": "cp",
        "scoreValue": 999,
        "pvUci": [],
    }

    api_client.put("/api/v1/explorer/evals/", deep_body, format="json")
    response = api_client.put("/api/v1/explorer/evals/", shallow_body, format="json")

    assert response.status_code == 200
    assert response.data["depth"] == 20
    assert response.data["scoreValue"] == 10
