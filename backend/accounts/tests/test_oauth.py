"""
Tests for the Lichess PKCE OAuth flow. All outbound HTTP is mocked with
`responses` - this suite must never hit a live Lichess API.
"""

import responses
from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import Client
from django.urls import reverse

from accounts.crypto import decrypt_token, encrypt_token
from accounts.models import LichessAccount

User = get_user_model()


def _register_lichess_success(*, lichess_id="123", username="DrNykterstein", access_token="secret-token"):
    responses.add(
        responses.POST,
        f"{settings.LICHESS_HOST}/api/token",
        json={"access_token": access_token, "token_type": "Bearer", "expires_in": 3600},
        status=200,
    )
    responses.add(
        responses.GET,
        f"{settings.LICHESS_HOST}/api/account",
        json={"id": lichess_id, "username": username},
        status=200,
    )


def test_session_reports_signed_out_state_and_sets_csrf_cookie(db):
    client = Client()
    response = client.get(reverse("auth-session"))

    assert response.status_code == 200
    assert response.json() == {"authenticated": False, "user": None}
    assert "csrftoken" in response.cookies


def test_session_reports_user_and_lichess_username_when_signed_in(db):
    user = User.objects.create_user(username="DrNykterstein")
    LichessAccount.objects.create(
        user=user,
        lichess_id="123",
        lichess_username="DrNykterstein",
        encrypted_access_token=encrypt_token("t"),
    )
    client = Client()
    client.force_login(user)

    response = client.get(reverse("auth-session"))

    assert response.json() == {
        "authenticated": True,
        "user": {"id": user.id, "username": "DrNykterstein", "lichessUsername": "DrNykterstein"},
    }


def test_lichess_start_redirects_to_lichess_with_pkce_params(db):
    client = Client()
    response = client.get(reverse("auth-lichess-start"))

    assert response.status_code == 302
    assert response.url.startswith(f"{settings.LICHESS_HOST}/oauth?")
    assert "code_challenge=" in response.url
    assert "code_challenge_method=S256" in response.url
    assert "state=" in response.url
    # No scopes at all - the Opening Explorer only needs a token to exist.
    assert "scope=" not in response.url

    session = client.session
    assert "lichess_oauth" in session
    assert session["lichess_oauth"]["code_verifier"]
    assert session["lichess_oauth"]["state"]


def test_lichess_start_ignores_an_absolute_next(db):
    client = Client()
    client.get(f"{reverse('auth-lichess-start')}?next=http://evil.example/steal")

    assert client.session["lichess_oauth"]["next"] is None


def test_lichess_start_records_a_relative_next(db):
    client = Client()
    client.get(f"{reverse('auth-lichess-start')}?next=/repertoire")

    assert client.session["lichess_oauth"]["next"] == "/repertoire"


def test_callback_without_a_prior_start_is_rejected(db):
    client = Client()
    response = client.get(f"{reverse('auth-lichess-callback')}?code=abc&state=whatever")

    assert response.status_code == 302
    assert response.url.startswith(settings.FRONTEND_URL)
    assert "authError=state_mismatch" in response.url


def test_callback_rejects_a_mismatched_state(db):
    client = Client()
    client.get(reverse("auth-lichess-start"))

    response = client.get(f"{reverse('auth-lichess-callback')}?code=abc&state=not-the-real-state")

    assert response.status_code == 302
    assert "authError=state_mismatch" in response.url
    assert not User.objects.exists()
    # Single-use: the pending PKCE data must be gone even on a rejected callback.
    assert "lichess_oauth" not in client.session


@responses.activate
def test_successful_callback_creates_user_and_logs_in(db):
    _register_lichess_success()
    client = Client()
    start_response = client.get(reverse("auth-lichess-start"))
    state = client.session["lichess_oauth"]["state"]

    response = client.get(f"{reverse('auth-lichess-callback')}?code=abc123&state={state}")

    assert response.status_code == 302
    assert response.url == settings.FRONTEND_URL

    user = User.objects.get(username="DrNykterstein")
    account = LichessAccount.objects.get(user=user)
    assert account.lichess_id == "123"
    assert account.lichess_username == "DrNykterstein"

    # The session created by the callback should now be authenticated.
    session_response = client.get(reverse("auth-session"))
    assert session_response.json()["authenticated"] is True
    del start_response  # unused beyond triggering the session write


@responses.activate
def test_successful_callback_honors_the_recorded_next_path(db):
    _register_lichess_success()
    client = Client()
    client.get(f"{reverse('auth-lichess-start')}?next=/repertoire")
    state = client.session["lichess_oauth"]["state"]

    response = client.get(f"{reverse('auth-lichess-callback')}?code=abc123&state={state}")

    assert response.url == f"{settings.FRONTEND_URL}/repertoire"


@responses.activate
def test_repeat_login_updates_the_existing_account_not_a_duplicate(db):
    _register_lichess_success()
    client = Client()

    for _ in range(2):
        client.get(reverse("auth-lichess-start"))
        state = client.session["lichess_oauth"]["state"]
        client.get(f"{reverse('auth-lichess-callback')}?code=abc123&state={state}")

    assert User.objects.filter(username="DrNykterstein").count() == 1
    assert LichessAccount.objects.filter(lichess_id="123").count() == 1


@responses.activate
def test_callback_redirects_with_error_slug_when_token_exchange_fails(db):
    responses.add(responses.POST, f"{settings.LICHESS_HOST}/api/token", status=400)
    client = Client()
    client.get(reverse("auth-lichess-start"))
    state = client.session["lichess_oauth"]["state"]

    response = client.get(f"{reverse('auth-lichess-callback')}?code=abc123&state={state}")

    assert response.status_code == 302
    assert "authError=oauth_failed" in response.url
    assert not User.objects.exists()


def test_token_is_never_serialized_in_the_session_response(db):
    user = User.objects.create_user(username="DrNykterstein")
    LichessAccount.objects.create(
        user=user,
        lichess_id="123",
        lichess_username="DrNykterstein",
        encrypted_access_token=encrypt_token("super-secret-token"),
    )
    client = Client()
    client.force_login(user)

    response = client.get(reverse("auth-session"))

    assert "super-secret-token" not in response.content.decode()
    assert "access_token" not in response.json()["user"]
    assert "encrypted_access_token" not in response.json()["user"]


def test_logout_flushes_the_session(db):
    user = User.objects.create_user(username="DrNykterstein")
    client = Client()
    client.force_login(user)

    response = client.post(reverse("auth-logout"))

    assert response.status_code == 204
    assert not client.session.get("_auth_user_id")


def test_token_round_trips_through_encryption():
    encrypted = encrypt_token("my-access-token")
    assert encrypted != "my-access-token"
    assert decrypt_token(encrypted) == "my-access-token"


def test_lichess_account_access_token_property_round_trips(db):
    user = User.objects.create_user(username="someone")
    account = LichessAccount(user=user, lichess_id="1", lichess_username="someone")
    account.access_token = "raw-token"

    assert account.encrypted_access_token != "raw-token"
    assert account.access_token == "raw-token"
