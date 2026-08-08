"""Lichess OAuth (PKCE), user profile, and encrypted token storage."""

from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """
    Custom user model, in place from the very first migration.

    Django makes swapping `AUTH_USER_MODEL` later extremely awkward, so this
    exists up front even though it adds nothing to `AbstractUser` yet. Accounts
    are normally created by the Lichess OAuth callback rather than by password
    signup, so `username` mirrors the Lichess username and OAuth-created
    accounts are left with an unusable password.
    """

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return self.username


# The `LichessAccount` model (lichess id, encrypted access token, expiry) is
# added alongside the OAuth flow - see backend/API_CONTRACT.md.
