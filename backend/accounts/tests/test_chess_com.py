"""Chess.com username linking; all Published Data API calls are mocked."""

import responses
from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import Client
from django.urls import reverse

from accounts.models import ChessComAccount

User = get_user_model()


def _signed_in_client():
    user = User.objects.create_user(username="mainline-user")
    client = Client()
    client.force_login(user)
    return client, user


@responses.activate
def test_link_validates_and_stores_canonical_public_username(db):
    client, user = _signed_in_client()
    responses.add(
        responses.GET, f"{settings.CHESS_COM_API_URL}/player/hikaru", json={"username": "Hikaru"}, status=200
    )

    response = client.put(reverse("auth-chess-com"), {"username": "hikaru"}, content_type="application/json")

    assert response.status_code == 200
    assert response.json()["chessComUsername"] == "Hikaru"
    assert ChessComAccount.objects.get(user=user).username == "Hikaru"
    assert responses.calls[0].request.headers["User-Agent"] == settings.CHESS_COM_USER_AGENT


@responses.activate
def test_unknown_username_is_not_linked(db):
    client, user = _signed_in_client()
    responses.add(responses.GET, f"{settings.CHESS_COM_API_URL}/player/missing", status=404)

    response = client.put(reverse("auth-chess-com"), {"username": "missing"}, content_type="application/json")

    assert response.status_code == 400
    assert not ChessComAccount.objects.filter(user=user).exists()


def test_link_requires_sign_in(db):
    response = Client().put(
        reverse("auth-chess-com"), {"username": "hikaru"}, content_type="application/json"
    )
    assert response.status_code == 403


def test_disconnect_removes_link_and_session_reports_it(db):
    client, user = _signed_in_client()
    ChessComAccount.objects.create(user=user, username="Hikaru")

    assert client.delete(reverse("auth-chess-com")).status_code == 204
    assert client.get(reverse("auth-session")).json()["user"]["chessComUsername"] is None
