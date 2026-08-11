"""External chess identities, user profile, and encrypted token storage."""

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models

from .crypto import decrypt_token, encrypt_token


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


class LichessAccount(models.Model):
    """
    One Lichess identity per `User`, created/updated by the OAuth callback
    (see accounts/views.py). The access token is encrypted at rest and only
    ever decrypted through the `access_token` property below or, for other
    apps, `accounts.tokens.get_lichess_access_token` - nothing outside this
    module should read `encrypted_access_token` directly.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="lichess_account"
    )
    lichess_id = models.CharField(max_length=64, unique=True)
    lichess_username = models.CharField(max_length=64)
    encrypted_access_token = models.TextField()
    token_expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.lichess_username} ({self.user_id})"

    @property
    def access_token(self) -> str:
        """Decrypts and returns the stored Lichess access token."""
        return decrypt_token(self.encrypted_access_token)

    @access_token.setter
    def access_token(self, raw_token: str) -> None:
        self.encrypted_access_token = encrypt_token(raw_token)


class ChessComAccount(models.Model):
    """A public Chess.com username attached to a Mainline user.

    Chess.com's Published Data API is read-only and has no generally available
    OAuth flow. This stores only a verified public username, not credentials or
    proof that the Mainline user owns the Chess.com account.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chess_com_account"
    )
    username = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.username} ({self.user_id})"
