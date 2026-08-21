from unittest.mock import Mock

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

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
    generated = GenerationResult(
        name="Fried Liver Attack",
        color="white",
        prefix_uci=["e2e4"],
        lines=[["e2e4", "e7e5"]],
        reports=[],
        settings={"max_lines": 15},
        engine=None,
    )
    generate = Mock(return_value=generated)
    monkeypatch.setattr("repertoire.generator_views.generate_candidate", generate)

    body = payload()
    body["lichessToken"] = "token"
    response = client.post(reverse("opening-template-generate"), body, format="json")

    assert response.status_code == 200
    assert response.data["leafCount"] == 1
    assert response.data["pgn"].startswith('[Event "Fried Liver Attack"]')
    assert response.data["report"]["generation"] == {"max_lines": 15}
    assert generate.call_args.args[0] == ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "f3g5"]


def test_generation_validates_prefix_before_fetching(client, db):
    body = payload()
    body["prefix"] = ["e5"]

    response = client.post(reverse("opening-template-generate"), body, format="json")

    assert response.status_code == 400
    assert "Illegal or invalid" in str(response.data["prefix"])
