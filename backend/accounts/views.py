"""DRF views for the accounts app. See backend/API_CONTRACT.md for the endpoints."""

from datetime import timedelta
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import login, logout
from django.http import HttpResponseRedirect
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import oauth
from .models import LichessAccount, User
from .serializers import SessionSerializer, UserSerializer

# Session key the PKCE verifier/state pair (and the recorded `next` redirect
# path) are stashed under between `lichess_start` and `lichess_callback`.
OAUTH_SESSION_KEY = "lichess_oauth"


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
    *, next_path: str | None = None, auth_error: str | None = None
) -> HttpResponseRedirect:
    target = settings.FRONTEND_URL.rstrip("/") + (next_path or "")
    if auth_error:
        separator = "&" if "?" in target else "?"
        target = f"{target}{separator}{urlencode({'authError': auth_error})}"
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


@extend_schema(exclude=True)  # browser redirect, not a JSON API - see the docstring below
@require_GET
def lichess_start(request):
    """
    `GET /api/v1/auth/lichess/start/` - kicks off the PKCE flow: stash a fresh
    verifier/state pair in the session and send the browser to Lichess. This
    is a plain Django view rather than a DRF one because it's not an XHR
    endpoint at all - the frontend navigates the whole page here, so a JSON
    body would never be seen.
    """
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
    creates-or-updates the `User`/`LichessAccount`, logs the user in, and
    redirects back to the frontend. Every failure path redirects with
    `?authError=<slug>` instead of raising, per the contract - an OAuth error
    page with no way back to the app would strand the user.
    """
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
        if user.username != lichess_username:
            # Lichess usernames are unique and immutable-ish, but a rename is
            # possible; keep the mirrored Django username in sync with it.
            user.username = lichess_username
            user.save(update_fields=["username"])
    else:
        user, _ = User.objects.get_or_create(username=lichess_username)
        account = LichessAccount(user=user, lichess_id=lichess_id)

    account.lichess_username = lichess_username
    account.access_token = access_token  # encrypted by the model property setter
    account.token_expires_at = expires_at
    account.save()

    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return _frontend_redirect(next_path=next_path)


class LogoutView(APIView):
    """`POST /api/v1/auth/logout/` - flushes the session. `204 No Content`."""

    @extend_schema(summary="Log out.", request=None, responses={204: None})
    def post(self, request):
        logout(request)
        return Response(status=204)
