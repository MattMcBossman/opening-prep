"""
The single supported way for other apps (namely `explorer_cache`) to read a
signed-in user's decrypted Lichess access token - see the accounts/repertoire
agent's report in the phase 4 plan. Nothing outside `accounts/` should touch
`LichessAccount.encrypted_access_token` directly.
"""

import logging

from cryptography.fernet import InvalidToken

from .models import LichessAccount, User

logger = logging.getLogger(__name__)


def get_lichess_access_token(user: User) -> str | None:
    """
    Returns the decrypted token for `user`, or `None` if there isn't one.

    "No linked Lichess account", "not signed in at all", and "stored ciphertext
    can't be decrypted" (e.g. `TOKEN_ENCRYPTION_KEY` was rotated) all collapse
    to `None` rather than raising, so a token problem degrades the explorer
    proxy for one user instead of surfacing as a 500 from an otherwise
    unrelated endpoint.
    """
    try:
        account = user.lichess_account
    except LichessAccount.DoesNotExist:
        return None
    except AttributeError:
        # An AnonymousUser has no `lichess_account` descriptor at all. The
        # explorer proxy is AllowAny, so this is a perfectly ordinary call.
        return None
    try:
        return account.access_token
    except InvalidToken:
        logger.warning("Could not decrypt stored Lichess token for user id=%s", user.pk)
        return None
