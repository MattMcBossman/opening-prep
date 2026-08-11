import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from accounts.models import User
from explorer_cache import analysis_cache
from explorer_cache.models import PositionAnalysis

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
PROFILE = "drill-review-basic-v1"
ENGINE = "stockfish-18-lite-single"


def candidate(rank, depth, pv, score=20):
    return {
        "rank": rank,
        "depth": depth,
        "scoreType": "cp",
        "scoreValue": score,
        "bestMoveUci": pv[0],
        "pvUci": pv,
    }


def payload(depth=18):
    return {
        "fen": START_FEN,
        "engineVersion": ENGINE,
        "analysisProfile": PROFILE,
        "candidates": [
            candidate(1, depth, ["e2e4", "e7e5", "g1f3", "b8c6"]),
            candidate(2, depth, ["d2d4", "d7d5", "g1f3", "g8f6"], 15),
            candidate(3, depth, ["g1f3", "d7d5", "d2d4", "g8f6"], 10),
        ],
    }


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="analyst", password="x")


def test_position_analysis_requires_authentication(api_client):
    response = api_client.get(
        "/api/v1/explorer/position-analyses/",
        {"fen": START_FEN, "engineVersion": ENGINE, "analysisProfile": PROFILE},
    )
    assert response.status_code == 403


def test_upload_replays_pvs_and_derives_recurring_moves(api_client, user):
    api_client.force_authenticate(user=user)
    response = api_client.put("/api/v1/explorer/position-analyses/", payload(), format="json")
    assert response.status_code == 200
    assert response.data["depth"] == 18
    assert response.data["multiPv"] == 3
    assert {move["uci"]: move["lineCount"] for move in response.data["recurringMoves"]} == {
        "g1f3": 3,
        "d2d4": 2,
        "d7d5": 2,
        "g8f6": 2,
    }
    knight = next(move for move in response.data["recurringMoves"] if move["uci"] == "g1f3")
    assert knight["timing"] == "mixed"
    assert knight["immediateCandidateRank"] == 3
    assert knight["immediateCentipawnLoss"] == 10
    assert knight["prerequisiteLines"] == [["e2e4", "e7e5"], ["d2d4", "d7d5"]]

    fetched = api_client.get(
        "/api/v1/explorer/position-analyses/",
        {"fen": START_FEN, "engineVersion": ENGINE, "analysisProfile": PROFILE},
    )
    assert fetched.status_code == 200
    assert fetched.data["candidates"] == response.data["candidates"]


def test_upload_rejects_illegal_or_noncontiguous_candidates(api_client, user):
    api_client.force_authenticate(user=user)
    body = payload()
    body["candidates"][0]["pvUci"][1] = "e7e6"
    body["candidates"][0]["bestMoveUci"] = "e2e4"
    body["candidates"][1]["rank"] = 3
    response = api_client.put("/api/v1/explorer/position-analyses/", body, format="json")
    assert response.status_code == 400


def test_position_analysis_requests_are_throttled(api_client, user):
    cache.clear()
    api_client.force_authenticate(user=user)
    params = {"fen": START_FEN, "engineVersion": ENGINE, "analysisProfile": PROFILE}
    for _ in range(30):
        assert api_client.get("/api/v1/explorer/position-analyses/", params).status_code == 404
    assert api_client.get("/api/v1/explorer/position-analyses/", params).status_code == 429


@pytest.mark.django_db
def test_keep_strongest_uses_minimum_candidate_depth_then_breadth():
    weak = payload(14)["candidates"]
    strong = payload(18)["candidates"]
    row, stored = analysis_cache.upsert_position_analysis(
        fen=START_FEN, engine_version=ENGINE, analysis_profile=PROFILE, candidates=strong, recurring_moves=[]
    )
    assert stored
    kept, stored = analysis_cache.upsert_position_analysis(
        fen=START_FEN, engine_version=ENGINE, analysis_profile=PROFILE, candidates=weak, recurring_moves=[]
    )
    assert not stored
    assert kept.pk == row.pk
    assert kept.depth == 18
    assert PositionAnalysis.objects.count() == 1
