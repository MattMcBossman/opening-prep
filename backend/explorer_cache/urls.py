"""
Routes for the explorer_cache app, mounted under `/api/v1/` by `opening_prep/urls.py`.

The include already exists, so adding an endpoint means editing only this file.
"""

from django.urls import path

from . import views

urlpatterns = [
    path("stats/", views.ExplorerStatsView.as_view(), name="explorer-stats"),
    path("evals/", views.EngineEvalView.as_view(), name="explorer-evals"),
]
