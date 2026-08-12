"""DRF views for the accounts app. See backend/API_CONTRACT.md for the endpoints."""

import re
import secrets
from datetime import datetime, timedelta
from urllib.parse import quote, urlencode

import requests
from cryptography.fernet import InvalidToken
from django.conf import settings
from django.contrib.auth import login, logout
from django.db import IntegrityError, transaction
from django.http import HttpResponseRedirect
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import google_oauth, oauth
from .crypto import decrypt_token, encrypt_token
from .merging import can_merge_legacy_lichess_user, merge_legacy_lichess_user
from .models import ChessComAccount, EmailIdentity, GoogleAccount, LichessAccount, User
from .serializers import ChessComLinkSerializer, SessionSerializer, UserSerializer

# Session key the PKCE verifier/state pair (and the recorded `next` redirect
# path) are stashed under between `lichess_start` and `lichess_callback`.
OAUTH_SESSION_KEY = "lichess_oauth"
GOOGLE_OAUTH_SESSION_KEY = "google_oauth"
LICHESS_MERGE_SESSION_KEY = "lichess_account_merge"
LICHESS_MERGE_TTL_MINUTES = 10


def _masked_account_label(user: User) -> str:
    email = user.email.strip()
    if not email:
        return user.username
    local, separator, domain = email.partition("@")
    if not separator:
        return user.username
    visible = local[: min(3, len(local))]
    return f"{visible}{'*' * max(2, len(local) - len(visible))}@{domain}"


def _unique_username(label: str) -> str:
    base = re.sub(r"[^a-zA-Z0-9_.-]+", "-", label).strip("-.")[:120] or "mainline-player"
    candidate = base
    while User.objects.filter(username=candidate).exists():
        candidate = f"{base[:110]}-{secrets.token_hex(4)}"
    return candidate


def _user_for_verified_email(email: str, label: str | None = None) -> User:
    normalized = email.strip().lower()
    identity = EmailIdentity.objects.select_related("user").filter(email=normalized).first()
    if identity:
        return identity.user
    try:
        # A concurrent first Google sign-in may win the unique-email race
        # without poisoning the caller's outer transaction.
        with transaction.atomic():
            user = User.objects.create_user(
                username=_unique_username(label or normalized.split("@", 1)[0])
            )
            EmailIdentity.objects.create(user=user, email=normalized)
            return user
    except IntegrityError:
        return EmailIdentity.objects.select_related("user").get(email=normalized).user


def _safe_next(path: str | None) -> str | None:
    """
    Only same-origin relative paths are accepted for the post-login redirect -
    anything else (an absolute URL, `//host` protocol-relative, or nothing at
    all) is dropped rather than handed to `HttpResponseRedirect`, which would
    otherwise turn `next` into an open redirect.
    """
    if not path or not path.startswith("/") or path.startswith("//"):
        return None
    return path


def _frontend_redirect(
    *,
    next_path: str | None = None,
    auth_error: str | None = None,
    account_merge: str | None = None,
) -> HttpResponseRedirect:
    target = settings.FRONTEND_URL.rstrip("/") + (next_path or "")
    if auth_error:
        separator = "&" if "?" in target else "?"
        target = f"{target}{separator}{urlencode({'authError': auth_error})}"
    if account_merge:
        separator = "&" if "?" in target else "?"
        target = f"{target}{separator}{urlencode({'accountMerge': account_merge})}"
    return HttpResponseRedirect(target)


class SessionView(APIView):
    """
    `GET /api/v1/auth/session/` - the app's bootstrap call. Anonymous-safe, and
    ensures a CSRF cookie is set: the SPA needs one before it can make any
    unsafe (POST/DELETE) request, including logout.
    """

    permission_classes = [AllowAny]

    @extend_schema(
        summary="Bootstrap call: current auth state, and sets the CSRF cookie.",
        request=None,
        responses={200: SessionSerializer},
    )
    @method_decorator(ensure_csrf_cookie)
    def get(self, request):
        if request.user.is_authenticated:
            return Response({"authenticated": True, "user": UserSerializer(request.user).data})
        return Response({"authenticated": False, "user": None})


@extend_schema(exclude=True)
@require_GET
def google_start(request):
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        return _frontend_redirect(auth_error="google_unavailable")
    state = google_oauth.generate_state()
    request.session[GOOGLE_OAUTH_SESSION_KEY] = {
        "state": state,
        "next": _safe_next(request.GET.get("next")),
    }
    return HttpResponseRedirect(google_oauth.build_authorize_url(state=state))


@extend_schema(exclude=True)
@require_GET
def google_callback(request):
    pending = request.session.pop(GOOGLE_OAUTH_SESSION_KEY, None)
    next_path = pending.get("next") if pending else None
    if not pending or request.GET.get("state") != pending.get("state"):
        return _frontend_redirect(next_path=next_path, auth_error="state_mismatch")
    code = request.GET.get("code")
    if not code:
        return _frontend_redirect(next_path=next_path, auth_error="missing_code")
    try:
        profile = google_oauth.fetch_identity(code=code)
    except google_oauth.GoogleOAuthError:
        return _frontend_redirect(next_path=next_path, auth_error="google_oauth_failed")

    subject = str(profile["sub"])
    email = profile["email"].lower()
    try:
        with transaction.atomic():
            account = (
                GoogleAccount.objects.select_for_update()
                .select_related("user")
                .filter(subject=subject)
                .first()
            )
            email_identity = EmailIdentity.objects.select_related("user").filter(email=email).first()
            if account:
                user = account.user
                # A Google subject is durable. If its newly reported verified
                # email already authenticates a different Mainline account,
                # require manual resolution rather than joining or switching.
                if email_identity and email_identity.user_id != user.id:
                    return _frontend_redirect(next_path=next_path, auth_error="account_conflict")
            else:
                user = _user_for_verified_email(email, profile.get("name"))
                if request.user.is_authenticated and request.user.id != user.id:
                    return _frontend_redirect(next_path=next_path, auth_error="account_conflict")
                account = GoogleAccount(user=user, subject=subject)
            account.email = email
            account.save()
    except IntegrityError:
        return _frontend_redirect(next_path=next_path, auth_error="account_conflict")
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return _frontend_redirect(next_path=next_path)


@extend_schema(exclude=True)  # browser redirect, not a JSON API - see the docstring below
@require_GET
def lichess_start(request):
    """
    `GET /api/v1/auth/lichess/start/` - for a signed-in Mainline user, kicks off
    the PKCE linking flow: stash a fresh
    verifier/state pair in the session and send the browser to Lichess. This
    is a plain Django view rather than a DRF one because it's not an XHR
    endpoint at all - the frontend navigates the whole page here, so a JSON
    body would never be seen.
    """
    if not request.user.is_authenticated:
        return _frontend_redirect(auth_error="authentication_required")
    pkce = oauth.generate_pkce_pair()
    state = oauth.generate_state()
    request.session[OAUTH_SESSION_KEY] = {
        "state": state,
        "code_verifier": pkce.verifier,
        "next": _safe_next(request.GET.get("next")),
    }
    return HttpResponseRedirect(oauth.build_authorize_url(state=state, code_challenge=pkce.challenge))


@extend_schema(exclude=True)  # browser redirect, not a JSON API - see the docstring below
@require_GET
def lichess_callback(request):
    """
    `GET /api/v1/auth/lichess/callback/` - verifies `state`, exchanges the code,
    attaches or updates that user's `LichessAccount`, and redirects back to the
    frontend. It never authenticates a Mainline user. Every failure path redirects with
    `?authError=<slug>` instead of raising, per the contract - an OAuth error
    page with no way back to the app would strand the user.
    """
    if not request.user.is_authenticated:
        return _frontend_redirect(auth_error="authentication_required")

    # Single-use: pop immediately so a replayed callback can't reuse a stale
    # verifier, regardless of how this request turns out.
    pending = request.session.pop(OAUTH_SESSION_KEY, None)
    next_path = pending.get("next") if pending else None
    state = request.GET.get("state")
    code = request.GET.get("code")

    if not pending or not state or state != pending.get("state"):
        return _frontend_redirect(next_path=next_path, auth_error="state_mismatch")
    if not code:
        return _frontend_redirect(next_path=next_path, auth_error="missing_code")

    try:
        token_data = oauth.exchange_code(code=code, code_verifier=pending["code_verifier"])
        access_token = token_data["access_token"]
        profile = oauth.fetch_profile(access_token=access_token)
        lichess_id = str(profile["id"])
        lichess_username = profile["username"]
    except (oauth.LichessOAuthError, KeyError):
        return _frontend_redirect(next_path=next_path, auth_error="oauth_failed")

    expires_in = token_data.get("expires_in")
    expires_at = timezone.now() + timedelta(seconds=expires_in) if expires_in else None

    account = LichessAccount.objects.select_related("user").filter(lichess_id=lichess_id).first()
    if account:
        user = account.user
        if request.user.id != user.id:
            if not can_merge_legacy_lichess_user(user):
                return _frontend_redirect(next_path=next_path, auth_error="account_conflict")
            request.session[LICHESS_MERGE_SESSION_KEY] = {
                "legacy_user_id": user.id,
                "target_user_id": request.user.id,
                "lichess_id": lichess_id,
                "lichess_username": lichess_username,
                "encrypted_access_token": encrypt_token(access_token),
                "token_expires_at": expires_at.isoformat() if expires_at else None,
                "expires_at": (
                    timezone.now() + timedelta(minutes=LICHESS_MERGE_TTL_MINUTES)
                ).isoformat(),
            }
            return _frontend_redirect(next_path=next_path, account_merge="lichess")
    else:
        user = request.user
        if LichessAccount.objects.filter(user=user).exists():
            return _frontend_redirect(next_path=next_path, auth_error="account_conflict")
        account = LichessAccount(user=user, lichess_id=lichess_id)

    account.lichess_username = lichess_username
    account.access_token = access_token  # encrypted by the model property setter
    account.token_expires_at = expires_at
    try:
        account.save()
    except IntegrityError:
        return _frontend_redirect(next_path=next_path, auth_error="account_conflict")

    return _frontend_redirect(next_path=next_path)


class LichessAccountMergeView(APIView):
    """Preview, confirm, or cancel a pending legacy-account merge."""

    def _pending(self, request):
        pending = request.session.get(LICHESS_MERGE_SESSION_KEY)
        if not pending or pending.get("target_user_id") != request.user.id:
            return None
        try:
            if datetime.fromisoformat(pending["expires_at"]) <= timezone.now():
                request.session.pop(LICHESS_MERGE_SESSION_KEY, None)
                return None
        except (KeyError, TypeError, ValueError):
            request.session.pop(LICHESS_MERGE_SESSION_KEY, None)
            return None
        return pending

    @extend_schema(summary="Preview a pending Lichess account merge.", responses={200: dict})
    def get(self, request):
        pending = self._pending(request)
        if not pending:
            return Response({"detail": "No pending account merge."}, status=status.HTTP_404_NOT_FOUND)
        legacy = User.objects.filter(pk=pending["legacy_user_id"]).first()
        if not legacy or not can_merge_legacy_lichess_user(legacy):
            request.session.pop(LICHESS_MERGE_SESSION_KEY, None)
            return Response({"detail": "No pending account merge."}, status=status.HTTP_404_NOT_FOUND)
        return Response(
            {
                "lichessUsername": pending["lichess_username"],
                "legacyAccountLabel": _masked_account_label(legacy),
                "profiles": legacy.repertoire_profiles.count(),
                "modules": legacy.repertoires.count(),
                "drillSessions": legacy.drill_sessions.count(),
                "publishedOpenings": legacy.published_opening_templates.count(),
            }
        )

    @extend_schema(
        summary="Confirm a pending Lichess account merge.",
        request=None,
        responses={200: UserSerializer},
    )
    def post(self, request):
        pending = self._pending(request)
        if not pending:
            return Response({"detail": "No pending account merge."}, status=status.HTTP_404_NOT_FOUND)
        legacy = User.objects.filter(pk=pending["legacy_user_id"]).first()
        if not legacy:
            request.session.pop(LICHESS_MERGE_SESSION_KEY, None)
            return Response({"detail": "No pending account merge."}, status=status.HTTP_404_NOT_FOUND)
        try:
            token = decrypt_token(pending["encrypted_access_token"])
            with transaction.atomic():
                account = merge_legacy_lichess_user(legacy_user=legacy, target_user=request.user)
                account.lichess_username = pending["lichess_username"]
                account.access_token = token
                account.token_expires_at = (
                    datetime.fromisoformat(pending["token_expires_at"])
                    if pending.get("token_expires_at")
                    else None
                )
                account.save(
                    update_fields=[
                        "lichess_username",
                        "encrypted_access_token",
                        "token_expires_at",
                        "updated_at",
                    ]
                )
        except (InvalidToken, IntegrityError, ValueError):
            return Response({"detail": "The accounts could not be merged."}, status=status.HTTP_409_CONFLICT)
        request.session.pop(LICHESS_MERGE_SESSION_KEY, None)
        return Response(UserSerializer(request.user).data)

    @extend_schema(summary="Cancel a pending Lichess account merge.", request=None, responses={204: None})
    def delete(self, request):
        request.session.pop(LICHESS_MERGE_SESSION_KEY, None)
        return Response(status=status.HTTP_204_NO_CONTENT)


class LogoutView(APIView):
    """`POST /api/v1/auth/logout/` - flushes the session. `204 No Content`."""

    @extend_schema(summary="Log out.", request=None, responses={204: None})
    def post(self, request):
        logout(request)
        return Response(status=204)


class LichessAccountView(APIView):
    """Remove the optional Lichess data connection from a Mainline account."""

    @extend_schema(summary="Disconnect the linked Lichess account.", request=None, responses={204: None})
    def delete(self, request):
        LichessAccount.objects.filter(user=request.user).delete()
        return Response(status=204)


class ChessComAccountView(APIView):
    """Attach or remove a Chess.com public username from the signed-in user."""

    @extend_schema(
        summary="Validate and link a public Chess.com username.",
        request=ChessComLinkSerializer,
        responses={200: UserSerializer},
    )
    def put(self, request):
        serializer = ChessComLinkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        requested_username = serializer.validated_data["username"]
        url = f"{settings.CHESS_COM_API_URL.rstrip('/')}/player/{quote(requested_username, safe='')}"
        try:
            upstream = requests.get(
                url,
                headers={"User-Agent": settings.CHESS_COM_USER_AGENT, "Accept": "application/json"},
                timeout=10,
            )
        except requests.RequestException:
            return Response({"detail": "Chess.com is currently unavailable."}, status=503)

        if upstream.status_code in (404, 410):
            return Response({"username": ["Chess.com could not find that player."]}, status=400)
        if upstream.status_code == 429:
            return Response({"detail": "Chess.com rate-limited this request. Try again shortly."}, status=503)
        if not upstream.ok:
            return Response({"detail": "Chess.com is currently unavailable."}, status=503)
        try:
            canonical_username = upstream.json()["username"]
        except (ValueError, KeyError, TypeError):
            return Response({"detail": "Chess.com returned an invalid player profile."}, status=503)

        ChessComAccount.objects.update_or_create(user=request.user, defaults={"username": canonical_username})
        return Response(UserSerializer(request.user).data)

    @extend_schema(summary="Disconnect the linked Chess.com username.", request=None, responses={204: None})
    def delete(self, request):
        ChessComAccount.objects.filter(user=request.user).delete()
        return Response(status=204)
