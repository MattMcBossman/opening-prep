import pytest
from rest_framework.test import APIClient

from accounts.models import User
from common.fen import normalize_fen
from repertoire.models import Repertoire

START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"


@pytest.fixture
def owner(db):
    return User.objects.create_user(username="single-response")


@pytest.fixture
def client(owner):
    result = APIClient()
    result.force_authenticate(owner)
    return result


def test_module_rejects_and_can_explicitly_replace_response(client, owner):
    module = Repertoire.objects.create(owner=owner, name="One response", color="white")
    e4 = {"steps": [{"originFen": START, "san": "e4", "uci": "e2e4", "resultingFen": AFTER_E4}]}
    assert client.post(f"/api/v1/repertoires/{module.id}/lines/", e4, format="json").status_code == 200
    after_d4 = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1"
    d4 = {"steps": [{"originFen": START, "san": "d4", "uci": "d2d4", "resultingFen": after_d4}]}
    rejected = client.post(f"/api/v1/repertoires/{module.id}/lines/", d4, format="json")
    assert rejected.status_code == 409
    assert rejected.data["code"] == "response_conflict"
    assert list(module.moves.values_list("uci", flat=True)) == ["e2e4"]
    replaced = client.post(
        f"/api/v1/repertoires/{module.id}/lines/", {**d4, "conflictPolicy": "replace"}, format="json"
    )
    assert replaced.status_code == 200
    assert list(module.moves.values_list("uci", flat=True)) == ["d2d4"]
    assert list(module.lines.values_list("uci_path", flat=True)) == ["d2d4"]


def test_module_allows_multiple_opponent_replies(client, owner):
    module = Repertoire.objects.create(owner=owner, name="Opponent branches", color="white")
    replies = [
        ("e5", "e7e5", "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"),
        ("c5", "c7c5", "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"),
    ]
    for san, uci, resulting in replies:
        payload = {
            "steps": [
                {"originFen": START, "san": "e4", "uci": "e2e4", "resultingFen": AFTER_E4},
                {"originFen": AFTER_E4, "san": san, "uci": uci, "resultingFen": resulting},
            ]
        }
        assert (
            client.post(f"/api/v1/repertoires/{module.id}/lines/", payload, format="json").status_code == 200
        )
    assert set(module.moves.filter(origin_fen=normalize_fen(AFTER_E4)).values_list("uci", flat=True)) == {
        "e7e5",
        "c7c5",
    }
