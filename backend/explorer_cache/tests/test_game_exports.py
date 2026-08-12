import json

import pytest
import responses
from rest_framework.test import APIClient

from accounts.models import ChessComAccount, LichessAccount, User


@pytest.fixture
def user(db):
    return User.objects.create_user(username="mainline-user")


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_game_export_requires_authentication():
    assert APIClient().get("/api/v1/explorer/game-export/lichess/").status_code == 403


@responses.activate
def test_lichess_export_streams_ndjson_and_injects_linked_username(user):
    account = LichessAccount(user=user, lichess_id="abc", lichess_username="Alice")
    account.access_token = "secret"
    account.save()
    responses.add(
        responses.GET,
        "https://lichess.org/api/games/user/Alice",
        body='{"id":"g1","moves":"e4 e5"}\n',
        status=200,
        content_type="application/x-ndjson",
    )

    response = _client(user).get("/api/v1/explorer/game-export/lichess/")
    payload = json.loads(b"".join(response.streaming_content))

    assert response.status_code == 200
    assert payload["id"] == "g1"
    assert payload["mainlineUsername"] == "Alice"
    assert responses.calls[0].request.headers["Authorization"] == "Bearer secret"


@responses.activate
def test_chesscom_export_streams_archive_games_without_storing_them(user, settings):
    ChessComAccount.objects.create(user=user, username="Alice")
    settings.CHESS_COM_API_URL = "https://api.chess.com/pub"
    archive_url = "https://api.chess.com/pub/player/Alice/games/2026/08"
    responses.add(
        responses.GET,
        "https://api.chess.com/pub/player/Alice/games/archives",
        json={"archives": [archive_url]},
    )
    responses.add(responses.GET, archive_url, json={"games": [{"uuid": "g1", "pgn": "1. e4 e5"}]})

    response = _client(user).get("/api/v1/explorer/game-export/chesscom/")
    payload = json.loads(b"".join(response.streaming_content))

    assert response.status_code == 200
    assert payload["uuid"] == "g1"
    assert payload["mainlineUsername"] == "Alice"
