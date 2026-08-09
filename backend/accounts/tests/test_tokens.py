"""Tests for `accounts.tokens`, the one supported way for other apps (the
explorer proxies) to read a user's decrypted token and linked username."""

from django.contrib.auth import get_user_model

from accounts.models import LichessAccount
from accounts.tokens import get_lichess_access_token, get_lichess_username

User = get_user_model()


def test_returns_none_for_a_user_with_no_linked_account(db):
    user = User.objects.create_user(username="no-lichess")

    assert get_lichess_access_token(user) is None


def test_returns_the_decrypted_token_for_a_linked_account(db):
    user = User.objects.create_user(username="has-lichess")
    account = LichessAccount(user=user, lichess_id="1", lichess_username="has-lichess")
    account.access_token = "the-real-token"
    account.save()

    assert get_lichess_access_token(user) == "the-real-token"


def test_returns_none_rather_than_raising_when_ciphertext_is_undecryptable(db):
    user = User.objects.create_user(username="corrupted")
    LichessAccount.objects.create(
        user=user,
        lichess_id="1",
        lichess_username="corrupted",
        encrypted_access_token="not-valid-fernet-ciphertext",
    )

    assert get_lichess_access_token(user) is None


def test_get_lichess_username_returns_none_for_a_user_with_no_linked_account(db):
    user = User.objects.create_user(username="no-lichess")

    assert get_lichess_username(user) is None


def test_get_lichess_username_returns_the_linked_username(db):
    user = User.objects.create_user(username="has-lichess")
    LichessAccount.objects.create(user=user, lichess_id="1", lichess_username="DrNykterstein")

    assert get_lichess_username(user) == "DrNykterstein"
