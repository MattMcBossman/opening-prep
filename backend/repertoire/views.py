"""DRF views for the repertoire app. See backend/API_CONTRACT.md for the endpoints."""

from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema, extend_schema_view
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from common.fen import normalize_fen

from . import services
from .models import Repertoire
from .serializers import (
    AddMovesSerializer,
    ImportResponseSerializer,
    ImportSerializer,
    RemoveMoveSerializer,
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
        serializer.save(owner=self.request.user)


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
