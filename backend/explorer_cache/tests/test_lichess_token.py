"""
Tests for explorer_cache/lichess_token.py. These patch this module's own
lookup, never `accounts` directly - see the module docstring on why that
matters for staying green both standalone and after the accounts branch merges.
"""

from django.contrib.auth.models import AnonymousUser

from accounts.models import User
from explorer_cache import lichess_token


def test_anonymous_user_has_no_stored_token(db):
    assert lichess_token.token_for_user(AnonymousUser()) is None


def test_none_user_has_no_stored_token():
    assert lichess_token.token_for_user(None) is None


def test_authenticated_user_falls_back_to_none_without_accounts_tokens(db):
    """
    `accounts.tokens` doesn't exist on this branch yet (see the accounts app's
    `models.py`), so `_stored_user_token` should degrade to `None` via the
    `ImportError` branch rather than raising.
    """
    user = User.objects.create_user(username="alice", password="x")
    assert lichess_token.token_for_user(user) is None


def test_falls_back_to_server_token_setting(db, settings):
    settings.LICHESS_SERVER_TOKEN = "server-fallback-token"
    assert lichess_token.token_for_user(AnonymousUser()) == "server-fallback-token"


def test_stored_user_token_takes_priority_over_server_fallback(db, settings, monkeypatch):
    settings.LICHESS_SERVER_TOKEN = "server-fallback-token"
    user = User.objects.create_user(username="alice", password="x")
    monkeypatch.setattr(lichess_token, "_stored_user_token", lambda u: "user-token")

    assert lichess_token.token_for_user(user) == "user-token"
