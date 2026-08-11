"""
Routes for the explorer_cache app, mounted under `/api/v1/` by `opening_prep/urls.py`.

The include already exists, so adding an endpoint means editing only this file.
"""

from django.urls import path

from . import views

urlpatterns = [
    path("stats/", views.ExplorerStatsView.as_view(), name="explorer-stats"),
    path("my-games/", views.MyGamesExplorerView.as_view(), name="explorer-my-games"),
    path("evals/", views.EngineEvalView.as_view(), name="explorer-evals"),
    path("position-analyses/", views.PositionAnalysisView.as_view(), name="explorer-position-analyses"),
    path("position-features/", views.PositionFeatureSetView.as_view(), name="explorer-position-features"),
    path("move-comparisons/", views.MoveComparisonView.as_view(), name="explorer-move-comparisons"),
]
