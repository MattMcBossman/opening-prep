"""
Root URL configuration.

Every project app is included here from the outset, even before it has any
routes of its own, so that adding an endpoint only ever means editing that app's
own `urls.py` - this file is shared ground and should stay still.
"""

from django.contrib import admin
from django.db import connection
from django.http import FileResponse, Http404, JsonResponse
from django.urls import include, path, re_path
from django.views.generic import TemplateView
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def health(_request):
    """Liveness probe, also handy as a smoke test that the stack is wired up."""
    return JsonResponse({"status": "ok"})


def readiness(_request):
    """Database-dependent probe used by release smoke checks, not liveness."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        cursor.fetchone()
    return JsonResponse({"status": "ready"})


def spa_index(_request):
    """Serve the React shell for client-side routes without caching it."""
    from django.conf import settings

    index_path = settings.FRONTEND_DIST_DIR / "index.html"
    if not index_path.is_file():
        raise Http404("Frontend build is not installed")
    response = FileResponse(index_path.open("rb"), content_type="text/html")
    response["Cache-Control"] = "no-cache"
    return response


api_v1_patterns = [
    path("auth/", include("accounts.urls")),
    path("repertoires/", include("repertoire.urls")),
    path("opening-templates/", include("repertoire.global_urls")),
    path("explorer/", include("explorer_cache.urls")),
    path("drills/", include("drills.urls")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("privacy/", TemplateView.as_view(template_name="privacy.html"), name="privacy"),
    path("api/v1/health/", health, name="health"),
    path("api/v1/ready/", readiness, name="readiness"),
    path("api/v1/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/v1/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
    path("api/v1/", include(api_v1_patterns)),
    re_path(r"^(?!api/|admin/|static/).*$", spa_index, name="spa-index"),
]
