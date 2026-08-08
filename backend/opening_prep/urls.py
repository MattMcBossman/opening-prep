"""
Root URL configuration.

Every project app is included here from the outset, even before it has any
routes of its own, so that adding an endpoint only ever means editing that app's
own `urls.py` - this file is shared ground and should stay still.
"""

from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def health(_request):
    """Liveness probe, also handy as a smoke test that the stack is wired up."""
    return JsonResponse({"status": "ok"})


api_v1_patterns = [
    path("auth/", include("accounts.urls")),
    path("repertoires/", include("repertoire.urls")),
    path("explorer/", include("explorer_cache.urls")),
    path("drills/", include("drills.urls")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/health/", health, name="health"),
    path("api/v1/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/v1/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
    path("api/v1/", include(api_v1_patterns)),
]
