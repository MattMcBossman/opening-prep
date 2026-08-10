from django.urls import path

from . import views

urlpatterns = [
    path("", views.OpeningTemplateListView.as_view(), name="opening-template-list"),
    path(
        "<slug:slug>/releases/<int:version>/",
        views.OpeningTemplateReleaseDetailView.as_view(),
        name="opening-template-release",
    ),
    path(
        "<slug:slug>/releases/<int:version>/copy/",
        views.OpeningTemplateReleaseCopyView.as_view(),
        name="opening-template-release-copy",
    ),
    path(
        "<slug:slug>/releases/<int:version>/copy-missing/",
        views.OpeningTemplateReleaseCopyMissingView.as_view(),
        name="opening-template-release-copy-missing",
    ),
]
