from django.urls import path

from . import generator_views, views

urlpatterns = [
    path("generate/", generator_views.OpeningGenerationView.as_view(), name="opening-template-generate"),
    path("generate-progress/<uuid:progress_id>/", generator_views.OpeningGenerationProgressView.as_view(), name="opening-template-generate-progress"),
    path("publish/", views.OpeningTemplatePublishView.as_view(), name="opening-template-publish"),
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
