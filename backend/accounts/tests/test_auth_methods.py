from django.test import Client, override_settings
from django.urls import reverse

from accounts.models import EmailIdentity, GoogleAccount, User


def test_email_magic_link_routes_are_disabled(db):
    client = Client()
    assert client.post("/api/v1/auth/email/", {"email": "player@example.com"}).status_code == 404
    assert client.get("/api/v1/auth/email/callback/", {"token": "unused"}).status_code == 404


@override_settings(
    GOOGLE_CLIENT_ID="google-client",
    GOOGLE_CLIENT_SECRET="google-secret",
    GOOGLE_REDIRECT_URI="http://testserver/api/v1/auth/google/callback",
)
def test_google_sign_in_creates_verified_email_identity(db, monkeypatch):
    client = Client()
    start = client.get(reverse("auth-google-start"))
    assert start.status_code == 302
    assert start.url.startswith("https://accounts.google.com/")
    state = client.session["google_oauth"]["state"]

    monkeypatch.setattr(
        "accounts.views.google_oauth.fetch_identity",
        lambda **kwargs: {
            "sub": "google-123",
            "email": "player@example.com",
            "email_verified": True,
            "name": "Chess Player",
        },
    )
    callback = client.get(reverse("auth-google-callback"), {"state": state, "code": "code"})

    assert callback.status_code == 302
    account = GoogleAccount.objects.select_related("user").get(subject="google-123")
    assert account.user.email_identity.email == "player@example.com"
    assert client.get(reverse("auth-session")).json()["user"]["email"] == "player@example.com"


def test_google_sign_in_reports_unconfigured_provider(db):
    with override_settings(GOOGLE_CLIENT_ID="", GOOGLE_CLIENT_SECRET=""):
        response = Client().get(reverse("auth-google-start"))
    assert "authError=google_unavailable" in response.url


@override_settings(
    GOOGLE_CLIENT_ID="google-client",
    GOOGLE_CLIENT_SECRET="google-secret",
    GOOGLE_REDIRECT_URI="http://testserver/api/v1/auth/google/callback",
)
def test_google_subject_cannot_claim_another_users_verified_email(db, monkeypatch):
    subject_user = User.objects.create_user(username="subject-owner")
    GoogleAccount.objects.create(
        user=subject_user, subject="google-123", email="old@example.com"
    )
    email_user = User.objects.create_user(username="email-owner")
    EmailIdentity.objects.create(user=email_user, email="new@example.com")
    client = Client()
    client.get(reverse("auth-google-start"))
    state = client.session["google_oauth"]["state"]
    monkeypatch.setattr(
        "accounts.views.google_oauth.fetch_identity",
        lambda **kwargs: {
            "sub": "google-123",
            "email": "new@example.com",
            "email_verified": True,
        },
    )

    callback = client.get(reverse("auth-google-callback"), {"state": state, "code": "code"})

    assert "authError=account_conflict" in callback.url
    assert client.get(reverse("auth-session")).json()["authenticated"] is False
    assert GoogleAccount.objects.get(subject="google-123").email == "old@example.com"
