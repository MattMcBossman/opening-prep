"""
Routes for the repertoire app, mounted under `/api/v1/` by `opening_prep/urls.py`.

The include already exists, so adding an endpoint means editing only this file.
"""

from django.urls import path

from . import views

urlpatterns = [
    path("", views.RepertoireListCreateView.as_view(), name="repertoire-list"),
    path("import/", views.RepertoireImportView.as_view(), name="repertoire-import"),
    path("<int:pk>/tree/", views.RepertoireTreeView.as_view(), name="repertoire-tree"),
    path("<int:pk>/moves/", views.RepertoireMovesView.as_view(), name="repertoire-moves"),
]
