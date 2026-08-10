"""DRF serializers for the explorer_cache app. See backend/API_CONTRACT.md for the shapes."""

import re

import chess
from rest_framework import serializers

from .models import EngineLineCache

# Lichess's rating-bracket markers and perf/speed types. Ratings apply only to
# `/lichess`; speeds are also accepted by the player-scoped `/player` endpoint.
ALLOWED_RATINGS = {"1600", "1800", "2000", "2200", "2500"}
ALLOWED_SPEEDS = {"ultraBullet", "bullet", "blitz", "rapid", "classical", "correspondence"}
_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


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


def validate_month(value: str) -> str:
    """Shared `since`/`until` validator - Lichess expects "YYYY-MM" for both explorer endpoints."""
    if not _MONTH_RE.match(value):
        raise serializers.ValidationError('Must be in "YYYY-MM" format.')
    return value


def _comma_separated_choice_validator(allowed: set[str], label: str):
    """
    Builds a validator for a comma-separated list of values (e.g.
    "1600,2000"), rather than DRF's usual repeated-key list handling - this
    matches how Lichess's own frontend actually sends these params (a single
    joined string, despite the API docs describing them as arrays - see
    cache.py's `_fetch_upstream`), so the same string can be forwarded
    upstream unchanged once validated.
    """

    def validator(value: str) -> str:
        values = [v for v in value.split(",") if v]
        invalid = sorted(set(values) - allowed)
        if invalid:
            raise serializers.ValidationError(f"Invalid {label}: {', '.join(invalid)}.")
        return value

    return validator


validate_ratings = _comma_separated_choice_validator(ALLOWED_RATINGS, "rating band(s)")
validate_speeds = _comma_separated_choice_validator(ALLOWED_SPEEDS, "speed(s)")


class ExplorerStatsQuerySerializer(serializers.Serializer):
    """Query params for `GET /explorer/stats/`."""

    fen = serializers.CharField(validators=[validate_fen])
    moves = serializers.IntegerField(required=False, default=12, min_value=1, max_value=30)
    since = serializers.CharField(required=False, validators=[validate_month])
    until = serializers.CharField(required=False, validators=[validate_month])
    ratings = serializers.CharField(required=False, validators=[validate_ratings])
    speeds = serializers.CharField(required=False, validators=[validate_speeds])


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
    queuePosition = serializers.IntegerField(required=False, min_value=0)


class MyGamesExplorerQuerySerializer(serializers.Serializer):
    """Query params for `GET /explorer/my-games/`."""

    fen = serializers.CharField(validators=[validate_fen])
    moves = serializers.IntegerField(required=False, default=12, min_value=1, max_value=30)
    color = serializers.ChoiceField(choices=["white", "black"])
    since = serializers.CharField(required=False, validators=[validate_month])
    until = serializers.CharField(required=False, validators=[validate_month])
    speeds = serializers.CharField(required=False, validators=[validate_speeds])


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
