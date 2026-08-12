"""Small server-side Google OpenID Connect authorization-code flow."""

import secrets
from urllib.parse import urlencode

import requests
from django.conf import settings


class GoogleOAuthError(Exception):
    pass


def generate_state() -> str:
    return secrets.token_urlsafe(32)


def build_authorize_url(*, state: str) -> str:
    return f"{settings.GOOGLE_AUTHORIZATION_URL}?{
        urlencode(
            {
                'client_id': settings.GOOGLE_CLIENT_ID,
                'redirect_uri': settings.GOOGLE_REDIRECT_URI,
                'response_type': 'code',
                'scope': 'openid email profile',
                'state': state,
                'prompt': 'select_account',
            }
        )
    }"


def fetch_identity(*, code: str) -> dict:
    try:
        token_response = requests.post(
            settings.GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
        token_response.raise_for_status()
        access_token = token_response.json()["access_token"]
        profile_response = requests.get(
            settings.GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        profile_response.raise_for_status()
        profile = profile_response.json()
    except (requests.RequestException, ValueError, KeyError) as exc:
        raise GoogleOAuthError("google_oauth_failed") from exc

    if not profile.get("sub") or not profile.get("email") or not profile.get("email_verified"):
        raise GoogleOAuthError("google_identity_invalid")
    return profile
