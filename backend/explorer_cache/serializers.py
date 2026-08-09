"""DRF serializers for the explorer_cache app. See backend/API_CONTRACT.md for the shapes."""

import chess
from rest_framework import serializers

from .models import EngineLineCache


def validate_fen(value: str) -> str:
    """
    Shared FEN validator: the contract says this endpoint accepts either a full
    or a normalized (4-field) FEN, and `chess.Board` already tolerates a
    missing halfmove clock/fullmove number by defaulting them - so this is
    only about rejecting genuinely malformed input with a 400 rather than
    passing it upstream or into the cache.
    """
    try:
        chess.Board(value)
    except ValueError as exc:
        raise serializers.ValidationError(f"Not a valid FEN: {exc}") from exc
    return value


class ExplorerStatsQuerySerializer(serializers.Serializer):
    """Query params for `GET /explorer/stats/`."""

    fen = serializers.CharField(validators=[validate_fen])
    moves = serializers.IntegerField(required=False, default=12, min_value=1, max_value=30)


class ExplorerMoveStatSerializer(serializers.Serializer):
    """One row of `ExplorerResponse.moves` - output only, never parsed from a request."""

    san = serializers.CharField()
    uci = serializers.CharField()
    white = serializers.IntegerField()
    draws = serializers.IntegerField()
    black = serializers.IntegerField()
    totalGames = serializers.IntegerField()


class ExplorerOpeningSerializer(serializers.Serializer):
    eco = serializers.CharField()
    name = serializers.CharField()


class ExplorerResponseSerializer(serializers.Serializer):
    """Matches `ExplorerResponse` in `frontend/src/types.ts` exactly - output only."""

    totalGames = serializers.IntegerField()
    moves = ExplorerMoveStatSerializer(many=True)
    opening = ExplorerOpeningSerializer(allow_null=True)


class MyGamesExplorerResponseSerializer(ExplorerResponseSerializer):
    """
    `ExplorerResponse` plus `stillIndexing` - only ever `True`, and only from
    `GET /explorer/my-games/` (see player_stats.py's ND-JSON draining), so this
    is never present at all on the shared `/explorer/stats/` response.
    """

    stillIndexing = serializers.BooleanField(required=False, default=False)


class MyGamesExplorerQuerySerializer(serializers.Serializer):
    """Query params for `GET /explorer/my-games/`."""

    fen = serializers.CharField(validators=[validate_fen])
    moves = serializers.IntegerField(required=False, default=12, min_value=1, max_value=30)
    color = serializers.ChoiceField(choices=["white", "black"])


class EngineEvalQuerySerializer(serializers.Serializer):
    """Query params for `GET /explorer/evals/`."""

    fen = serializers.CharField(validators=[validate_fen])


class EngineEvaluationSerializer(serializers.ModelSerializer):
    """
    Matches `EngineEvaluation` minus the client-only `thinking`/`terminal`
    flags (see API_CONTRACT.md), for both the `GET` read and the `PUT` upsert
    body. Field names are camelCase on the wire, mapped to the model's
    snake_case columns via `source=`.
    """

    fen = serializers.CharField(validators=[validate_fen])
    scoreType = serializers.ChoiceField(source="score_type", choices=EngineLineCache.SCORE_TYPE_CHOICES)
    scoreValue = serializers.IntegerField(source="score_value")
    bestMoveUci = serializers.CharField(source="best_move_uci", allow_null=True, required=False, max_length=8)
    pvUci = serializers.ListField(
        source="pv_uci", child=serializers.CharField(max_length=8), required=False, default=list
    )

    class Meta:
        model = EngineLineCache
        fields = ["fen", "depth", "scoreType", "scoreValue", "bestMoveUci", "pvUci"]
