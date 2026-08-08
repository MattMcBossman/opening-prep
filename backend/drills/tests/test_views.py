"""API-level tests for the drills endpoints. See API_CONTRACT.md."""

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from common.fen import normalize_fen
from drills.models import DrillAttempt, DrillLineResult, DrillSession

FEN_AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
FEN_START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


@pytest.fixture
def user(db):
    return User.objects.create_user(username="alice", password="x")


@pytest.fixture
def other_user(db):
    return User.objects.create_user(username="bob", password="x")


@pytest.fixture
def client(user):
    api_client = APIClient()
    api_client.force_authenticate(user=user)
    return api_client


def create_session(client, repertoire_id=1, is_retry_pass=False):
    response = client.post(
        "/api/v1/drills/sessions/",
        {"repertoireId": repertoire_id, "isRetryPass": is_retry_pass},
        format="json",
    )
    assert response.status_code == 201, response.data
    return response.data["id"]


# --- session creation --------------------------------------------------


def test_endpoints_require_authentication():
    # 403, not 401: with only SessionAuthentication configured (settings.py)
    # there's no WWW-Authenticate challenge, so DRF falls back to 403 for an
    # unauthenticated request rather than 401.
    anon = APIClient()
    assert anon.get("/api/v1/drills/sessions/").status_code == 403
    assert anon.post("/api/v1/drills/sessions/", {"repertoireId": 1}, format="json").status_code == 403
    assert anon.get("/api/v1/drills/stats/").status_code == 403


def test_create_session_returns_id_and_started_at(client):
    response = client.post("/api/v1/drills/sessions/", {"repertoireId": 1}, format="json")
    assert response.status_code == 201
    assert set(response.data.keys()) == {"id", "startedAt"}


def test_create_session_rejects_invalid_repertoire_id(client):
    response = client.post("/api/v1/drills/sessions/", {"repertoireId": -1}, format="json")
    assert response.status_code == 400


# --- attempts ------------------------------------------------------------


def test_batch_attempts_are_recorded(client, user):
    session_id = create_session(client)
    body = {
        "attempts": [
            {
                "originFen": FEN_START,
                "playedUci": "e2e4",
                "isCorrect": True,
                "attemptNumber": 1,
                "lineId": "e2e4 e7e5",
            },
            {
                "originFen": FEN_AFTER_E4,
                "playedUci": "g8f6",
                "isCorrect": False,
                "attemptNumber": 1,
                "cpLoss": 120,
                "isBad": True,
                "lineId": "e2e4 e7e5",
            },
        ]
    }

    response = client.post(f"/api/v1/drills/sessions/{session_id}/attempts/", body, format="json")
    assert response.status_code == 204

    attempts = list(DrillAttempt.objects.filter(session_id=session_id).order_by("id"))
    assert len(attempts) == 2
    # Stored normalized, regardless of whether the client sent a full FEN.
    assert attempts[0].origin_fen == normalize_fen(FEN_START)
    assert attempts[0].is_correct is True
    assert attempts[1].cp_loss == 120
    assert attempts[1].is_bad is True


def test_attempts_optional_fields_default_to_none(client):
    session_id = create_session(client)
    body = {
        "attempts": [
            {
                "originFen": FEN_START,
                "playedUci": "e2e4",
                "isCorrect": True,
                "attemptNumber": 1,
                "lineId": "e2e4",
            }
        ]
    }
    client.post(f"/api/v1/drills/sessions/{session_id}/attempts/", body, format="json")

    attempt = DrillAttempt.objects.get(session_id=session_id)
    assert attempt.cp_loss is None
    assert attempt.is_bad is None


def test_attempts_on_another_users_session_is_not_found(client, other_user):
    other_client = APIClient()
    other_client.force_authenticate(user=other_user)
    session_id = create_session(other_client)

    response = client.post(
        f"/api/v1/drills/sessions/{session_id}/attempts/",
        {
            "attempts": [
                {
                    "originFen": FEN_START,
                    "playedUci": "e2e4",
                    "isCorrect": True,
                    "attemptNumber": 1,
                    "lineId": "x",
                }
            ]
        },
        format="json",
    )
    assert response.status_code == 404


# --- finish ----------------------------------------------------------------


def test_finish_stores_line_results_and_returns_summary(client):
    session_id = create_session(client)
    body = {
        "results": [
            {"lineId": "e2e4 e7e5", "outcome": "perfect"},
            {"lineId": "d2d4 d7d5", "outcome": "failed"},
        ]
    }

    response = client.post(f"/api/v1/drills/sessions/{session_id}/finish/", body, format="json")
    assert response.status_code == 200
    assert response.data["perfect"] == 1
    assert response.data["failed"] == 1
    assert response.data["finishedAt"] is not None
    assert DrillLineResult.objects.filter(session_id=session_id).count() == 2


def test_finish_is_idempotent(client):
    session_id = create_session(client)
    body = {"results": [{"lineId": "e2e4 e7e5", "outcome": "perfect"}]}

    first = client.post(f"/api/v1/drills/sessions/{session_id}/finish/", body, format="json")
    second = client.post(f"/api/v1/drills/sessions/{session_id}/finish/", body, format="json")

    assert first.data == second.data
    assert DrillLineResult.objects.filter(session_id=session_id).count() == 1


def test_finish_on_another_users_session_is_not_found(client, other_user):
    other_client = APIClient()
    other_client.force_authenticate(user=other_user)
    session_id = create_session(other_client)

    response = client.post(f"/api/v1/drills/sessions/{session_id}/finish/", {"results": []}, format="json")
    assert response.status_code == 404


# --- listing -----------------------------------------------------------


def test_list_sessions_only_returns_own_sessions(client, other_user):
    own_id = create_session(client)
    client.post(
        f"/api/v1/drills/sessions/{own_id}/finish/",
        {"results": [{"lineId": "a", "outcome": "perfect"}, {"lineId": "b", "outcome": "failed"}]},
        format="json",
    )

    other_client = APIClient()
    other_client.force_authenticate(user=other_user)
    create_session(other_client)

    response = client.get("/api/v1/drills/sessions/")
    assert response.status_code == 200
    assert [row["id"] for row in response.data] == [own_id]
    assert response.data[0]["perfect"] == 1
    assert response.data[0]["failed"] == 1


# --- stats -----------------------------------------------------------------


def test_stats_aggregates_across_multiple_sessions(client):
    session_1 = create_session(client)
    session_2 = create_session(client)

    def attempt(origin_fen, is_correct, line_id="x"):
        return {
            "originFen": origin_fen,
            "playedUci": "e2e4",
            "isCorrect": is_correct,
            "attemptNumber": 1,
            "lineId": line_id,
        }

    client.post(
        f"/api/v1/drills/sessions/{session_1}/attempts/",
        {"attempts": [attempt(FEN_START, True), attempt(FEN_START, False)]},
        format="json",
    )
    client.post(
        f"/api/v1/drills/sessions/{session_2}/attempts/",
        {"attempts": [attempt(FEN_START, False), attempt(FEN_AFTER_E4, True)]},
        format="json",
    )

    response = client.get("/api/v1/drills/stats/")
    assert response.status_code == 200

    by_fen = {row["originFen"]: row for row in response.data}
    assert by_fen[normalize_fen(FEN_START)]["attempts"] == 3
    assert by_fen[normalize_fen(FEN_START)]["mistakes"] == 2
    assert by_fen[normalize_fen(FEN_AFTER_E4)]["attempts"] == 1
    assert by_fen[normalize_fen(FEN_AFTER_E4)]["mistakes"] == 0

    # Sorted by mistake rate descending: FEN_START (2/3) before FEN_AFTER_E4 (0/1).
    assert [row["originFen"] for row in response.data][0] == normalize_fen(FEN_START)


def test_stats_filters_by_repertoire(client):
    session_a = create_session(client, repertoire_id=1)
    session_b = create_session(client, repertoire_id=2)

    def attempt(line_id):
        return {
            "originFen": FEN_START,
            "playedUci": "e2e4",
            "isCorrect": True,
            "attemptNumber": 1,
            "lineId": line_id,
        }

    client.post(f"/api/v1/drills/sessions/{session_a}/attempts/", {"attempts": [attempt("a")]}, format="json")
    client.post(f"/api/v1/drills/sessions/{session_b}/attempts/", {"attempts": [attempt("b")]}, format="json")

    response = client.get("/api/v1/drills/stats/", {"repertoire": 1})
    assert response.status_code == 200
    assert len(response.data) == 1
    assert response.data[0]["attempts"] == 1


def test_stats_excludes_other_users_attempts(client, other_user):
    session_id = create_session(client)
    client.post(
        f"/api/v1/drills/sessions/{session_id}/attempts/",
        {
            "attempts": [
                {
                    "originFen": FEN_START,
                    "playedUci": "e2e4",
                    "isCorrect": True,
                    "attemptNumber": 1,
                    "lineId": "x",
                }
            ]
        },
        format="json",
    )

    other_client = APIClient()
    other_client.force_authenticate(user=other_user)
    other_session_id = create_session(other_client)
    other_client.post(
        f"/api/v1/drills/sessions/{other_session_id}/attempts/",
        {
            "attempts": [
                {
                    "originFen": FEN_START,
                    "playedUci": "d2d4",
                    "isCorrect": False,
                    "attemptNumber": 1,
                    "lineId": "y",
                }
            ]
        },
        format="json",
    )

    response = client.get("/api/v1/drills/stats/")
    assert response.status_code == 200
    assert len(response.data) == 1
    assert response.data[0]["attempts"] == 1
    assert response.data[0]["mistakes"] == 0


def test_session_belongs_to_creating_user(db):
    """A session is always owned by whoever created it, never by an id in the body."""
    creator = User.objects.create_user(username="creator", password="x")
    client = APIClient()
    client.force_authenticate(user=creator)
    session_id = create_session(client)
    assert DrillSession.objects.get(id=session_id).user == creator
