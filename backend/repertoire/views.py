"""DRF views for the repertoire app. See backend/API_CONTRACT.md for the endpoints."""

from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from common.fen import normalize_fen

from . import services
from .models import Repertoire
from .serializers import (
    AddMovesSerializer,
    ImportSerializer,
    RemoveMoveSerializer,
    RepertoireSerializer,
)
from .validation import validate_edge


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

    def get(self, request, pk: int):
        repertoire = _get_owned_repertoire(request, pk)
        return Response(services.serialize_tree(repertoire))


class RepertoireMovesView(APIView):
    """`POST`/`DELETE /api/v1/repertoires/{id}/moves/`."""

    def post(self, request, pk: int):
        repertoire = _get_owned_repertoire(request, pk)
        serializer = AddMovesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        moves = serializer.validated_data["moves"]
        for move in moves:
            validate_edge(normalize_fen(move["originFen"]), move["uci"])
        tree = services.add_moves(repertoire, moves)
        return Response(tree)

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

    def post(self, request):
        serializer = ImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = {}
        for color in (Repertoire.WHITE, Repertoire.BLACK):
            tree_payload = serializer.validated_data.get(color) or {}
            repertoire = services.get_or_create_default(request.user, color)
            result[color] = services.import_tree(repertoire, tree_payload)
        return Response(result)
