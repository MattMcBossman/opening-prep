"""
Lichess OAuth2 PKCE helpers: challenge/state generation and the two upstream
HTTP calls the callback view needs. Confirmed against the reference
implementation in `openingtree/src/pres/MainContainer.js (81-115)` - Lichess is
a public client (no client secret) and the Opening Explorer needs no scopes at
all, so neither appears anywhere below.
"""

import base64
import hashlib
import secrets
from dataclasses import dataclass
from urllib.parse import urlencode

import requests
from django.conf import settings


class LichessOAuthError(Exception):
    """
    Raised for any failure exchanging a code or fetching a profile, so the
    callback view can redirect with a generic `?authError=` slug rather than
    leaking upstream error details (or a stack trace) to the browser.
    """


@dataclass(frozen=True)
class PkcePair:
    verifier: str
    challenge: str


def generate_pkce_pair() -> PkcePair:
    # 64 random bytes -> ~86 url-safe chars, comfortably inside the RFC 7636
    # 43-128 character range for a code_verifier.
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return PkcePair(verifier=verifier, challenge=challenge)


def generate_state() -> str:
    return secrets.token_urlsafe(32)


def build_authorize_url(*, state: str, code_challenge: str) -> str:
    params = {
        "response_type": "code",
        "client_id": settings.LICHESS_CLIENT_ID,
        "redirect_uri": settings.LICHESS_REDIRECT_URI,
        "code_challenge_method": "S256",
        "code_challenge": code_challenge,
        "state": state,
    }
    return f"{settings.LICHESS_HOST}/oauth?{urlencode(params)}"


def exchange_code(*, code: str, code_verifier: str) -> dict:
    """POSTs the authorization code + verifier for an access token. Raises
    `LichessOAuthError` on any transport failure or non-2xx response."""
    try:
        response = requests.post(
            f"{settings.LICHESS_HOST}/api/token",
            json={
                "grant_type": "authorization_code",
                "code": code,
                "code_verifier": code_verifier,
                "redirect_uri": settings.LICHESS_REDIRECT_URI,
                "client_id": settings.LICHESS_CLIENT_ID,
            },
            timeout=10,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        raise LichessOAuthError("token_exchange_failed") from exc
    return response.json()


def fetch_profile(*, access_token: str) -> dict:
    """GETs the Lichess account profile for the just-issued token. Raises
    `LichessOAuthError` on any transport failure or non-2xx response."""
    try:
        response = requests.get(
            f"{settings.LICHESS_HOST}/api/account",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        raise LichessOAuthError("profile_fetch_failed") from exc
    return response.json()
