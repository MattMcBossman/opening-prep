"""
Resolves the Lichess API token to use for an explorer request.

The encrypted-token storage (`LichessAccount`) is owned by the `accounts` app,
built in parallel on a different branch. The supported entry point is
`accounts.tokens.get_lichess_access_token(user) -> str | None`, which never
raises - it returns `None` for both "no linked account" and "decryption
failed" (logging a warning itself in the latter case), so `None` here always
just means "no token available", never an error to propagate. The import stays
lazy so this module - and its tests - still work standalone before that
branch is merged in.
"""

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser


def token_for_user(user: AbstractBaseUser | None) -> str | None:
    """
    Returns a Bearer token to use for the Lichess explorer, or `None` if none
    is available. Preference order: the signed-in user's own stored Lichess
    token, then an optional server-wide fallback token (`LICHESS_SERVER_TOKEN`,
    unset by default) so anonymous browsing can still work if an operator
    configures one.
    """
    if user is not None and getattr(user, "is_authenticated", False):
        token = _stored_user_token(user)
        if token:
            return token
    return getattr(settings, "LICHESS_SERVER_TOKEN", None) or None


def _stored_user_token(user: AbstractBaseUser) -> str | None:
    try:
        from accounts.tokens import get_lichess_access_token
    except ImportError:
        # accounts.tokens doesn't exist yet on this branch.
        return None
    return get_lichess_access_token(user)
