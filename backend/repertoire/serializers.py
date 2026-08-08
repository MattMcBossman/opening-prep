"""DRF serializers for the repertoire app. See backend/API_CONTRACT.md for the shapes."""

from rest_framework import serializers

from .models import Repertoire


class RepertoireSerializer(serializers.ModelSerializer):
    """Shape for `GET/POST /repertoires/` - `moveCount` is computed, not stored."""

    moveCount = serializers.IntegerField(source="moves.count", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)

    class Meta:
        model = Repertoire
        fields = ["id", "name", "color", "moveCount", "createdAt", "updatedAt"]


class TreeEdgeSerializer(serializers.Serializer):
    """One `RepertoireMove` as it appears inside a `RepertoireTree` value - no
    `originFen`, since that's the dict key it's nested under."""

    san = serializers.CharField()
    uci = serializers.CharField()
    resultingFen = serializers.CharField()


class MoveInputSerializer(TreeEdgeSerializer):
    """One edge in the `POST .../moves/` body, which - unlike a tree value -
    needs its own origin since it isn't nested under one."""

    originFen = serializers.CharField()


class AddMovesSerializer(serializers.Serializer):
    moves = MoveInputSerializer(many=True)


class RemoveMoveSerializer(serializers.Serializer):
    originFen = serializers.CharField()
    uci = serializers.CharField()


class ImportSerializer(serializers.Serializer):
    """Body of `POST /repertoires/import/`: the two trees exactly as
    `useRepertoire`'s localStorage shape stores them, e.g.
    `{"white": {"<fen>": [{san, uci, resultingFen}]}}`."""

    white = serializers.DictField(child=TreeEdgeSerializer(many=True), required=False, default=dict)
    black = serializers.DictField(child=TreeEdgeSerializer(many=True), required=False, default=dict)
