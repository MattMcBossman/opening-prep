"""
Routes for the drills app, mounted under `/api/v1/` by `opening_prep/urls.py`.

The include already exists, so adding an endpoint means editing only this file.
"""

from django.urls import path

from . import views

urlpatterns = [
    path("sessions/", views.DrillSessionListCreateView.as_view(), name="drill-sessions"),
    path(
        "sessions/<int:session_id>/attempts/",
        views.DrillAttemptsView.as_view(),
        name="drill-session-attempts",
    ),
    path("sessions/<int:session_id>/finish/", views.DrillFinishView.as_view(), name="drill-session-finish"),
    path("stats/", views.DrillStatsView.as_view(), name="drill-stats"),
]
