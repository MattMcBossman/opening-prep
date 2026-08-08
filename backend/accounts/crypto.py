"""
Small Fernet wrapper for Lichess token encryption.

The explorer proxy needs a *recoverable* access token to call Lichess on the
user's behalf, so this cannot be a one-way hash. Keeping the raw Fernet calls
in one small module (rather than inline on the model) makes it easy to see
every place ciphertext is produced or consumed.
"""

from cryptography.fernet import Fernet
from django.conf import settings


def _fernet() -> Fernet:
    # Constructed per call rather than cached: settings.TOKEN_ENCRYPTION_KEY can
    # differ between test cases (override_settings) and the dev/prod process,
    # and a module-level cache would silently keep using a stale key.
    return Fernet(settings.TOKEN_ENCRYPTION_KEY.encode())


def encrypt_token(raw_token: str) -> str:
    return _fernet().encrypt(raw_token.encode()).decode()


def decrypt_token(encrypted_token: str) -> str:
    return _fernet().decrypt(encrypted_token.encode()).decode()
