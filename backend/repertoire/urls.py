"""
Routes for the repertoire app, mounted under `/api/v1/` by `opening_prep/urls.py`.

The include already exists, so adding an endpoint means editing only this file.
"""

from django.urls import path

from . import views

urlpatterns = [
    path("profiles/", views.RepertoireProfileListCreateView.as_view(), name="repertoire-profile-list"),
    path(
        "profiles/<int:pk>/",
        views.RepertoireProfileDetailView.as_view(),
        name="repertoire-profile-detail",
    ),
    path(
        "profiles/<int:pk>/modules/",
        views.RepertoireProfileModulesView.as_view(),
        name="repertoire-profile-modules",
    ),
    path("", views.RepertoireListCreateView.as_view(), name="repertoire-list"),
    path("import/", views.RepertoireImportView.as_view(), name="repertoire-import"),
    path("<int:pk>/tree/", views.RepertoireTreeView.as_view(), name="repertoire-tree"),
    path("<int:pk>/", views.RepertoireDetailView.as_view(), name="repertoire-detail"),
    path("<int:pk>/lines/", views.RepertoireLinesView.as_view(), name="repertoire-lines"),
    path(
        "<int:pk>/lines/<uuid:line_id>/",
        views.RepertoireLineDetailView.as_view(),
        name="repertoire-line-detail",
    ),
    path("<int:pk>/moves/", views.RepertoireMovesView.as_view(), name="repertoire-moves"),
]
