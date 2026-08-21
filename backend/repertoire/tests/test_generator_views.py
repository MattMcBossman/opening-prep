from unittest.mock import Mock

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from repertoire.gap_recommender import GapCandidate
from repertoire.generator_views import OpeningGenerationRequestSerializer
from repertoire.opening_generator import GenerationResult


@pytest.fixture
def client():
    return APIClient()


def payload():
    return {
        "name": "Fried Liver Attack",
        "color": "white",
        "prefix": ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5"],
        "maxLines": 15,
        "maxPly": 22,
    }


def test_generation_defaults_to_fifty_leaves_and_sixty_percent_coverage():
    body = payload()
    body.pop("maxLines")
    serializer = OpeningGenerationRequestSerializer(data=body)

    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["maxLines"] == 50
    assert serializer.validated_data["coverage"] == 0.60


def test_generation_is_available_anonymously_with_supplied_token(client, db, monkeypatch):
    monkeypatch.setattr("repertoire.generator_views.discover_module_gaps", Mock(return_value=[]))
    monkeypatch.setattr(
        "repertoire.generator_views.generate_candidate",
        Mock(
            return_value=GenerationResult(
                name="Test",
                color="white",
                prefix_uci=["e2e4"],
                lines=[["e2e4"]],
                reports=[],
                settings={},
                engine=None,
            )
        ),
    )
    body = payload()
    body["lichessToken"] = "personal-token"
    response = client.post(reverse("opening-template-generate"), body, format="json")
    assert response.status_code == 200


def test_generation_reports_missing_lichess_token(client, db, monkeypatch):
    monkeypatch.setattr("repertoire.generator_views.get_lichess_access_token", lambda _user: None)
    monkeypatch.setattr("repertoire.generator_views.token_for_user", lambda _user: None)

    response = client.post(reverse("opening-template-generate"), payload(), format="json")

    assert response.status_code == 409
    assert "Connect Lichess" in response.data["detail"]


def test_generation_returns_pgn_and_report(client, db, monkeypatch):
    monkeypatch.setattr("repertoire.generator_views.get_lichess_access_token", lambda _user: "token")
    prefix = ("e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "f3g5")
    gap = GapCandidate("root", "root", prefix, "", 1, 1, 1000, kind="terminal")
    generated = GenerationResult(
        name="Fried Liver Attack",
        color="white",
        prefix_uci=list(prefix),
        lines=[[*prefix, "d7d5"]],
        reports=[],
        settings={"max_lines": 15},
        engine=None,
    )
    generate = Mock(return_value=generated)
    monkeypatch.setattr("repertoire.generator_views.discover_module_gaps", Mock(return_value=[gap]))
    monkeypatch.setattr("repertoire.generator_views.generate_candidate", generate)

    body = payload()
    body["lichessToken"] = "token"
    body["progressId"] = "d4cc98cf-5531-4187-a8f6-f75d98bc2771"
    response = client.post(reverse("opening-template-generate"), body, format="json")
    progress = client.get(
        reverse("opening-template-generate-progress", kwargs={"progress_id": body["progressId"]})
    )

    assert response.status_code == 200
    assert response.data["leafCount"] == 1
    assert response.data["pgn"].startswith('[Event "Fried Liver Attack"]')
    assert response.data["proposals"][0]["id"] == "root"
    assert progress.data["suggestions"][0]["id"] == "root"
    assert generate.call_args.args[0] == list(prefix)


def test_generation_exposes_live_progress(client, db, monkeypatch):
    monkeypatch.setattr("repertoire.generator_views.token_for_user", lambda _user: "token")
    monkeypatch.setattr(
        "repertoire.generator_views.generate_candidate",
        Mock(return_value=GenerationResult("Test", "white", ["e2e4"], [["e2e4"]], [], {}, None)),
    )
    monkeypatch.setattr("repertoire.generator_views.discover_module_gaps", Mock(return_value=[]))
    progress_id = "25a62d5e-3f0d-4c7c-b8a9-4c1fc7bf4010"
    body = payload()
    body["progressId"] = progress_id

    response = client.post(reverse("opening-template-generate"), body, format="json")
    progress = client.get(reverse("opening-template-generate-progress", kwargs={"progress_id": progress_id}))

    assert response.status_code == 200
    assert progress.status_code == 200
    assert progress.data["phase"] == "complete"
    assert progress.data["message"] == "Building the review preview…"


def test_generation_validates_prefix_before_fetching(client, db):
    body = payload()
    body["prefix"] = ["e5"]

    response = client.post(reverse("opening-template-generate"), body, format="json")

    assert response.status_code == 400
    assert "Illegal or invalid" in str(response.data["prefix"])


def test_gap_filling_extends_discovered_module_gaps(client, db, monkeypatch):
    monkeypatch.setattr("repertoire.generator_views.token_for_user", lambda _user: "token")
    gap = GapCandidate(
        id="sicilian",
        gap_key="after-e4|c7c5",
        path_uci=("e2e4", "c7c5"),
        resulting_fen="rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
        reach_rate=1,
        response_rate=0.3,
        move_games=300,
    )
    discover = Mock(return_value=[gap])
    generate = Mock(return_value=GenerationResult(
        name="Gaps",
        color="white",
        prefix_uci=list(gap.path_uci),
        lines=[["e2e4", "c7c5", "g1f3"]],
        reports=[],
        settings={},
        engine=None,
    ))
    monkeypatch.setattr("repertoire.generator_views.discover_module_gaps", discover)
    monkeypatch.setattr("repertoire.generator_views.generate_candidate", generate)
    body = payload()
    body.update({
        "name": "Gaps",
        "prefix": ["e4"],
        "mode": "fill_gaps",
        "existingLines": [["e4", "e5", "Nf3"]],
        "moveBudget": 5,
    })

    response = client.post(reverse("opening-template-generate"), body, format="json")

    assert response.status_code == 200
    assert response.data["proposals"][0]["id"] == "sicilian"
    assert response.data["proposals"][0]["marginalCoverage"] == 0.3
    assert "1. e4 c5 2. Nf3" in response.data["pgn"]
    assert discover.call_args.args[1] == ("e2e4",)
