"""DRF views for the repertoire app. See backend/API_CONTRACT.md for the endpoints."""

from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema, extend_schema_view
from rest_framework import generics
from rest_framework import serializers as drf_serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from common.fen import normalize_fen

from . import services
from .models import (
    OpeningTemplate,
    OpeningTemplateRelease,
    ProfileModule,
    ProfileTemplateRelease,
    Repertoire,
    RepertoireProfile,
)
from .serializers import (
    AddMovesSerializer,
    AuthoredLineInputSerializer,
    CopyMissingTemplateLinesSerializer,
    CopyTemplateSerializer,
    ImportResponseSerializer,
    ImportSerializer,
    OpeningTemplateReleaseSerializer,
    OpeningTemplateSerializer,
    ProfileModuleMutationSerializer,
    ProfileTemplateMutationSerializer,
    RemoveMoveSerializer,
    RepertoireLineSerializer,
    RepertoireProfileSerializer,
    RepertoireSerializer,
)
from .validation import validate_edge

# Documentation-only: `GET .../tree/` and the moves endpoints return a bare
# `{<normalized origin FEN>: TreeEdge[]}` object with no fixed top-level keys,
# so - unlike everything else in this file - drf-spectacular can't build its
# schema from a Serializer. This raw OpenAPI schema fragment (kept in sync
# with `TreeEdgeSerializer`'s fields) is what @extend_schema uses instead.
REPERTOIRE_TREE_RESPONSE = OpenApiResponse(
    response={
        "type": "object",
        "additionalProperties": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "san": {"type": "string"},
                    "uci": {"type": "string"},
                    "resultingFen": {"type": "string"},
                },
                "required": ["san", "uci", "resultingFen"],
            },
        },
    },
    description="Normalized origin FEN -> the edges saved from that position.",
)
# DRF's default 404 body, `{"detail": "..."}` - raised here by `get_object_or_404`.
NOT_OWNED_RESPONSE = OpenApiResponse(
    response={
        "type": "object",
        "properties": {"detail": {"type": "string"}},
        "required": ["detail"],
    },
    description=(
        "Not found - either the repertoire doesn't exist, or it isn't owned by the caller "
        "(deliberately not distinguished from a 403 - see API_CONTRACT.md)."
    ),
)
# DRF's default per-field validation-error body: field name -> list of messages.
# The actual field name varies (`originFen`, `uci`, or nested under `moves` for
# the batch endpoint), so this documents the general shape rather than one
# fixed set of properties.
ILLEGAL_MOVE_RESPONSE = OpenApiResponse(
    response={"type": "object", "additionalProperties": {"type": "array", "items": {"type": "string"}}},
    description="Per-field validation error: an unparseable FEN, or an illegal move in its origin position.",
)


@extend_schema_view(
    get=extend_schema(summary="List the caller's repertoires."),
    post=extend_schema(summary="Create a new repertoire for the caller."),
)
class RepertoireListCreateView(generics.ListCreateAPIView):
    """`GET/POST /api/v1/repertoires/`, always scoped to the caller - see
    API_CONTRACT.md's ownership rule (404, not 403, for someone else's)."""

    serializer_class = RepertoireSerializer

    def get_queryset(self):
        return Repertoire.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        module = serializer.save(owner=self.request.user)
        profile = services.get_or_create_default_profile(self.request.user)
        ProfileModule.objects.get_or_create(
            profile=profile,
            module=module,
            defaults={"sort_order": profile.module_links.count()},
        )


@extend_schema_view(
    get=extend_schema(summary="Fetch a personal opening module."),
    patch=extend_schema(summary="Rename or describe a personal opening module."),
    delete=extend_schema(summary="Delete a personal opening module."),
)
class RepertoireDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = RepertoireSerializer
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return Repertoire.objects.filter(owner=self.request.user)


@extend_schema_view(
    get=extend_schema(summary="List the caller's composed repertoire profiles."),
    post=extend_schema(summary="Create a composed repertoire profile."),
)
class RepertoireProfileListCreateView(generics.ListCreateAPIView):
    serializer_class = RepertoireProfileSerializer

    def get_queryset(self):
        return RepertoireProfile.objects.filter(owner=self.request.user).prefetch_related(
            "module_links__module", "template_links__release__template"
        )

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)


@extend_schema_view(
    get=extend_schema(summary="Fetch one of the caller's repertoire profiles."),
    patch=extend_schema(summary="Rename or describe one of the caller's repertoire profiles."),
    delete=extend_schema(summary="Delete a profile without deleting its reusable modules."),
)
class RepertoireProfileDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = RepertoireProfileSerializer
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return RepertoireProfile.objects.filter(owner=self.request.user).prefetch_related(
            "module_links__module", "template_links__release__template"
        )


class RepertoireProfileModulesView(APIView):
    """Adds/removes a reusable personal module from a composed profile."""

    @extend_schema(
        summary="Add or update a personal opening module in a profile.",
        request=ProfileModuleMutationSerializer,
        responses={200: RepertoireProfileSerializer},
    )
    def post(self, request, pk: int):
        profile = get_object_or_404(RepertoireProfile, pk=pk, owner=request.user)
        serializer = ProfileModuleMutationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        module = get_object_or_404(
            Repertoire,
            pk=serializer.validated_data["moduleId"],
            owner=request.user,
        )
        ProfileModule.objects.update_or_create(
            profile=profile,
            module=module,
            defaults={
                "sort_order": serializer.validated_data["sortOrder"],
                "enabled": serializer.validated_data["enabled"],
            },
        )
        return Response(RepertoireProfileSerializer(profile).data)

    @extend_schema(request=ProfileModuleMutationSerializer, responses={200: RepertoireProfileSerializer})
    def delete(self, request, pk: int):
        profile = get_object_or_404(RepertoireProfile, pk=pk, owner=request.user)
        serializer = ProfileModuleMutationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        profile.module_links.filter(
            module_id=serializer.validated_data["moduleId"],
            module__owner=request.user,
        ).delete()
        return Response(RepertoireProfileSerializer(profile).data)


class RepertoireProfileTemplateReleasesView(APIView):
    @extend_schema(request=ProfileTemplateMutationSerializer, responses={200: RepertoireProfileSerializer})
    def post(self, request, pk: int):
        profile = get_object_or_404(RepertoireProfile, pk=pk, owner=request.user)
        body = ProfileTemplateMutationSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        release = get_object_or_404(
            OpeningTemplateRelease,
            pk=body.validated_data["templateReleaseId"],
            template__is_published=True,
        )
        ProfileTemplateRelease.objects.update_or_create(
            profile=profile,
            release=release,
            defaults={
                "sort_order": body.validated_data["sortOrder"],
                "enabled": body.validated_data["enabled"],
            },
        )
        return Response(RepertoireProfileSerializer(profile).data)

    @extend_schema(request=ProfileTemplateMutationSerializer, responses={200: RepertoireProfileSerializer})
    def delete(self, request, pk: int):
        profile = get_object_or_404(RepertoireProfile, pk=pk, owner=request.user)
        body = ProfileTemplateMutationSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        profile.template_links.filter(release_id=body.validated_data["templateReleaseId"]).delete()
        return Response(RepertoireProfileSerializer(profile).data)


def _get_owned_repertoire(request, pk: int) -> Repertoire:
    """404s (not 403s) for a repertoire that exists but isn't the caller's -
    the contract deliberately doesn't distinguish "not found" from "not yours"."""
    return get_object_or_404(Repertoire, pk=pk, owner=request.user)


class RepertoireTreeView(APIView):
    """`GET /api/v1/repertoires/{id}/tree/`."""

    @extend_schema(
        summary="Fetch a repertoire's full move tree.",
        request=None,
        responses={200: REPERTOIRE_TREE_RESPONSE, 404: NOT_OWNED_RESPONSE},
    )
    def get(self, request, pk: int):
        repertoire = _get_owned_repertoire(request, pk)
        return Response(services.serialize_tree(repertoire))


class RepertoireLinesView(APIView):
    """Read-only compatibility view of explicit lines derived from the graph."""

    @extend_schema(
        summary="Fetch a module's explicit, ordered move lines.",
        request=None,
        responses={200: RepertoireLineSerializer(many=True), 404: NOT_OWNED_RESPONSE},
    )
    def get(self, request, pk: int):
        repertoire = _get_owned_repertoire(request, pk)
        lines = repertoire.lines.prefetch_related("steps__move")
        return Response(RepertoireLineSerializer(lines, many=True).data)

    @extend_schema(request=AuthoredLineInputSerializer, responses={200: RepertoireLineSerializer(many=True)})
    def post(self, request, pk: int):
        repertoire = _get_owned_repertoire(request, pk)
        body = AuthoredLineInputSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            services.add_authored_line(repertoire, **body.validated_data)
        except ValueError as exc:
            raise drf_serializers.ValidationError({"steps": str(exc)}) from exc
        lines = repertoire.lines.prefetch_related("steps__move")
        return Response(RepertoireLineSerializer(lines, many=True).data)


class RepertoireLineDetailView(APIView):
    @extend_schema(request=None, responses={204: None})
    def delete(self, request, pk: int, line_id):
        repertoire = _get_owned_repertoire(request, pk)
        line = get_object_or_404(repertoire.lines, pk=line_id)
        services.delete_authored_line(repertoire, line)
        return Response(status=204)


class OpeningTemplateListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = OpeningTemplateSerializer
    queryset = OpeningTemplate.objects.filter(is_published=True).prefetch_related("releases")


class OpeningTemplateReleaseDetailView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={200: OpeningTemplateReleaseSerializer})
    def get(self, request, slug: str, version: int):
        release = get_object_or_404(
            OpeningTemplateRelease, template__slug=slug, template__is_published=True, version=version
        )
        return Response(OpeningTemplateReleaseSerializer(release).data)


class OpeningTemplateReleaseCopyView(APIView):
    @extend_schema(request=CopyTemplateSerializer, responses={201: RepertoireSerializer})
    def post(self, request, slug: str, version: int):
        release = get_object_or_404(
            OpeningTemplateRelease, template__slug=slug, template__is_published=True, version=version
        )
        body = CopyTemplateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        profile = None
        if profile_id := body.validated_data.get("profileId"):
            profile = get_object_or_404(RepertoireProfile, pk=profile_id, owner=request.user)
        module = Repertoire.objects.create(
            owner=request.user,
            color=release.template.color,
            source_release=release,
            name=body.validated_data.get("name", release.template.name),
            description=release.template.description,
        )
        services.import_release_lines(module, release)
        if profile:
            ProfileModule.objects.create(
                profile=profile, module=module, sort_order=profile.module_links.count()
            )
        return Response(RepertoireSerializer(module).data, status=201)


class OpeningTemplateReleaseCopyMissingView(APIView):
    @extend_schema(request=CopyMissingTemplateLinesSerializer, responses={200: dict})
    def post(self, request, slug: str, version: int):
        release = get_object_or_404(
            OpeningTemplateRelease, template__slug=slug, template__is_published=True, version=version
        )
        body = CopyMissingTemplateLinesSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        module = get_object_or_404(
            Repertoire,
            pk=body.validated_data["moduleId"],
            owner=request.user,
            color=release.template.color,
        )
        return Response(services.import_missing_release_lines(module, release))


class RepertoireMovesView(APIView):
    """`POST`/`DELETE /api/v1/repertoires/{id}/moves/`."""

    @extend_schema(
        summary="Add one or more edges, cascading like the client's own-move save.",
        description="Adding an existing edge is a no-op, not an error. Atomic across the whole batch.",
        request=AddMovesSerializer,
        responses={200: REPERTOIRE_TREE_RESPONSE, 400: ILLEGAL_MOVE_RESPONSE, 404: NOT_OWNED_RESPONSE},
    )
    def post(self, request, pk: int):
        repertoire = _get_owned_repertoire(request, pk)
        serializer = AddMovesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        moves = serializer.validated_data["moves"]
        for move in moves:
            validate_edge(normalize_fen(move["originFen"]), move["uci"])
        tree = services.add_moves(repertoire, moves)
        return Response(tree)

    @extend_schema(
        summary="Remove one edge and apply the cascade-delete rules.",
        description=(
            "Deletes the edge, then its now-unreachable subtree (unless still reachable via a "
            "transposition), then any now-response-less opponent replies one step up - see "
            "API_CONTRACT.md and repertoire/cascade.py.\n\n"
            'Request body (`RemoveMoveSerializer`): `{"originFen": string, "uci": string}`. '
            "Not rendered as a structural `requestBody` above - drf-spectacular does not support "
            "one for DELETE - but this is a real JSON body, matching API_CONTRACT.md."
        ),
        responses={200: REPERTOIRE_TREE_RESPONSE, 404: NOT_OWNED_RESPONSE},
    )
    def delete(self, request, pk: int):
        repertoire = _get_owned_repertoire(request, pk)
        serializer = RemoveMoveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tree = services.remove_move(
            repertoire,
            serializer.validated_data["originFen"],
            serializer.validated_data["uci"],
        )
        return Response(tree)


class RepertoireImportView(APIView):
    """`POST /api/v1/repertoires/import/` - one-time `localStorage` migration.
    Creates the caller's default white/black repertoires if they don't exist
    yet, rather than requiring the frontend to create them first."""

    @extend_schema(
        summary="One-time import of a localStorage repertoire.",
        description="Idempotent: edges already present are skipped, not duplicated.",
        request=ImportSerializer,
        responses={200: ImportResponseSerializer},
    )
    def post(self, request):
        serializer = ImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = {}
        for color in (Repertoire.WHITE, Repertoire.BLACK):
            tree_payload = serializer.validated_data.get(color) or {}
            repertoire = services.get_or_create_default(request.user, color)
            result[color] = services.import_tree(repertoire, tree_payload)
        return Response(result)
