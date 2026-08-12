"""DRF serializers for the explorer_cache app. See backend/API_CONTRACT.md for the shapes."""

import re

import chess
from rest_framework import serializers

from .models import EngineLineCache, PositionAnalysis, PositionFeatureSet

ANALYSIS_PROFILE_BASIC = "drill-review-basic-v1"
ANALYSIS_ENGINE_VERSION = "stockfish-18-lite-single"

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
validate_databases = _comma_separated_choice_validator({"lichess", "chesscom"}, "database(s)")


class ExplorerStatsQuerySerializer(serializers.Serializer):
    """Query params for `GET /explorer/stats/`."""

    fen = serializers.CharField(validators=[validate_fen])
    moves = serializers.IntegerField(required=False, default=12, min_value=1, max_value=30)
    since = serializers.CharField(required=False, validators=[validate_month])
    until = serializers.CharField(required=False, validators=[validate_month])
    ratings = serializers.CharField(required=False, validators=[validate_ratings])
    speeds = serializers.CharField(required=False, validators=[validate_speeds])


class ExplorerOpeningSerializer(serializers.Serializer):
    eco = serializers.CharField()
    name = serializers.CharField()


class ExplorerMoveStatSerializer(serializers.Serializer):
    """One row of `ExplorerResponse.moves` - output only, never parsed from a request."""

    san = serializers.CharField()
    uci = serializers.CharField()
    white = serializers.IntegerField()
    draws = serializers.IntegerField()
    black = serializers.IntegerField()
    totalGames = serializers.IntegerField()
    opening = ExplorerOpeningSerializer(allow_null=True, required=False)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if "opening" not in instance:
            data.pop("opening", None)
        return data


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
    databases = serializers.CharField(
        required=False, default="lichess,chesscom", validators=[validate_databases]
    )


class EngineEvalQuerySerializer(serializers.Serializer):
    """Query params for `GET /explorer/evals/`."""

    fen = serializers.CharField(validators=[validate_fen])
    engineVersion = serializers.CharField(max_length=64)


class EngineEvaluationSerializer(serializers.ModelSerializer):
    """
    Matches `EngineEvaluation` minus the client-only `thinking`/`terminal`
    flags (see API_CONTRACT.md), for both the `GET` read and the `PUT` upsert
    body. Field names are camelCase on the wire, mapped to the model's
    snake_case columns via `source=`.
    """

    fen = serializers.CharField(validators=[validate_fen])
    engineVersion = serializers.CharField(source="engine_version", max_length=64)
    scoreType = serializers.ChoiceField(source="score_type", choices=EngineLineCache.SCORE_TYPE_CHOICES)
    scoreValue = serializers.IntegerField(source="score_value")
    bestMoveUci = serializers.CharField(source="best_move_uci", allow_null=True, required=False, max_length=8)
    pvUci = serializers.ListField(
        source="pv_uci", child=serializers.CharField(max_length=8), required=False, default=list
    )

    class Meta:
        model = EngineLineCache
        fields = ["fen", "engineVersion", "depth", "scoreType", "scoreValue", "bestMoveUci", "pvUci"]


class PositionAnalysisQuerySerializer(serializers.Serializer):
    fen = serializers.CharField(validators=[validate_fen])
    engineVersion = serializers.ChoiceField(choices=[ANALYSIS_ENGINE_VERSION])
    analysisProfile = serializers.ChoiceField(choices=[ANALYSIS_PROFILE_BASIC])


class AnalysisCandidateSerializer(serializers.Serializer):
    rank = serializers.IntegerField(min_value=1, max_value=3)
    depth = serializers.IntegerField(min_value=1, max_value=40)
    scoreType = serializers.ChoiceField(choices=EngineLineCache.SCORE_TYPE_CHOICES)
    scoreValue = serializers.IntegerField(min_value=-100_000, max_value=100_000)
    bestMoveUci = serializers.CharField(max_length=8)
    pvUci = serializers.ListField(child=serializers.CharField(max_length=8), min_length=1, max_length=10)


class RecurringMoveSerializer(serializers.Serializer):
    uci = serializers.CharField(max_length=8)
    san = serializers.CharField(max_length=16)
    side = serializers.ChoiceField(choices=["white", "black"])
    earliestPly = serializers.IntegerField(min_value=0, max_value=9)
    latestPly = serializers.IntegerField(min_value=0, max_value=9)
    lineCount = serializers.IntegerField(min_value=2, max_value=3)
    totalLines = serializers.IntegerField(min_value=1, max_value=3)
    timing = serializers.ChoiceField(choices=["prepared", "mixed"])
    prerequisiteLines = serializers.ListField(
        child=serializers.ListField(child=serializers.CharField(max_length=8), max_length=9),
        max_length=3,
    )
    immediateCandidateRank = serializers.IntegerField(min_value=1, max_value=3, allow_null=True)
    immediateCentipawnLoss = serializers.IntegerField(min_value=0, max_value=200_000, allow_null=True)


def derive_recurring_moves(fen: str, candidates: list[dict]) -> list[dict]:
    occurrences: dict[tuple[str, str], dict] = {}
    for candidate in candidates:
        board = chess.Board(fen)
        seen_in_line: set[tuple[str, str]] = set()
        for ply, uci in enumerate(candidate["pvUci"]):
            move = chess.Move.from_uci(uci)
            side = "white" if board.turn == chess.WHITE else "black"
            san = board.san(move)
            key = (side, uci)
            evidence = occurrences.setdefault(
                key,
                {
                    "uci": uci,
                    "san": san,
                    "side": side,
                    "plies": [],
                    "lineCount": 0,
                    "prerequisiteLines": [],
                },
            )
            evidence["plies"].append(ply)
            if ply > 0:
                evidence["prerequisiteLines"].append(candidate["pvUci"][:ply])
            if key not in seen_in_line:
                evidence["lineCount"] += 1
                seen_in_line.add(key)
            board.push(move)
    result = []
    for evidence in occurrences.values():
        if evidence["lineCount"] < 2:
            continue
        immediate = next((item for item in candidates if item["bestMoveUci"] == evidence["uci"]), None)
        best = next((item for item in candidates if item["rank"] == 1), None)
        immediate_loss = None
        if immediate and best and immediate["scoreType"] == "cp" and best["scoreType"] == "cp":
            if evidence["side"] == "white":
                immediate_loss = max(0, best["scoreValue"] - immediate["scoreValue"])
            else:
                immediate_loss = max(0, immediate["scoreValue"] - best["scoreValue"])
        unique_prerequisites = list({tuple(line): line for line in evidence["prerequisiteLines"]}.values())[
            :3
        ]
        result.append(
            {
                "uci": evidence["uci"],
                "san": evidence["san"],
                "side": evidence["side"],
                "earliestPly": min(evidence["plies"]),
                "latestPly": max(evidence["plies"]),
                "lineCount": evidence["lineCount"],
                "totalLines": len(candidates),
                "timing": "mixed" if min(evidence["plies"]) == 0 else "prepared",
                "prerequisiteLines": unique_prerequisites,
                "immediateCandidateRank": immediate["rank"] if immediate else None,
                "immediateCentipawnLoss": immediate_loss,
            }
        )
    return sorted(result, key=lambda item: (-item["lineCount"], item["earliestPly"], item["uci"]))


class PositionAnalysisUploadSerializer(serializers.Serializer):
    fen = serializers.CharField(validators=[validate_fen])
    engineVersion = serializers.ChoiceField(choices=[ANALYSIS_ENGINE_VERSION])
    analysisProfile = serializers.ChoiceField(choices=[ANALYSIS_PROFILE_BASIC])
    candidates = AnalysisCandidateSerializer(many=True, min_length=1, max_length=3)

    def validate(self, attrs):
        candidates = sorted(attrs["candidates"], key=lambda item: item["rank"])
        if [item["rank"] for item in candidates] != list(range(1, len(candidates) + 1)):
            raise serializers.ValidationError({"candidates": "Ranks must be unique and contiguous from 1."})
        first_moves: set[str] = set()
        for index, candidate in enumerate(candidates):
            if candidate["bestMoveUci"] != candidate["pvUci"][0]:
                raise serializers.ValidationError(
                    {"candidates": f"Candidate {index + 1} best move must begin its PV."}
                )
            if candidate["bestMoveUci"] in first_moves:
                raise serializers.ValidationError({"candidates": "Candidate best moves must be unique."})
            first_moves.add(candidate["bestMoveUci"])
            board = chess.Board(attrs["fen"])
            for ply, uci in enumerate(candidate["pvUci"]):
                try:
                    move = chess.Move.from_uci(uci)
                except ValueError as exc:
                    raise serializers.ValidationError(
                        {"candidates": f"Candidate {index + 1} ply {ply + 1} is not UCI."}
                    ) from exc
                if move not in board.legal_moves:
                    raise serializers.ValidationError(
                        {"candidates": f"Candidate {index + 1} ply {ply + 1} is illegal."}
                    )
                board.push(move)
        attrs["candidates"] = candidates
        return attrs


class PositionAnalysisSerializer(serializers.ModelSerializer):
    engineVersion = serializers.CharField(source="engine_version")
    analysisProfile = serializers.CharField(source="analysis_profile")
    multiPv = serializers.IntegerField(source="multi_pv")
    candidates = AnalysisCandidateSerializer(many=True)
    recurringMoves = RecurringMoveSerializer(source="recurring_moves", many=True)
    updatedAt = serializers.DateTimeField(source="updated_at")

    class Meta:
        model = PositionAnalysis
        fields = [
            "fen",
            "engineVersion",
            "analysisProfile",
            "depth",
            "multiPv",
            "candidates",
            "recurringMoves",
            "updatedAt",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if any("timing" not in move for move in instance.recurring_moves):
            data["recurringMoves"] = derive_recurring_moves(instance.fen, instance.candidates)
        return data


class PositionFeatureQuerySerializer(serializers.Serializer):
    fen = serializers.CharField(validators=[validate_fen])


class MoveComparisonQuerySerializer(PositionFeatureQuerySerializer):
    move = serializers.RegexField(r"^[a-h][1-8][a-h][1-8][qrbn]?$", max_length=5)


class PositionFactSerializer(serializers.Serializer):
    id = serializers.CharField()
    category = serializers.ChoiceField(choices=["material", "pawns", "files", "activity", "king", "tactics"])
    kind = serializers.CharField()
    side = serializers.ChoiceField(choices=["white", "black", "both"])
    severity = serializers.ChoiceField(choices=["info", "advantage", "weakness", "warning"])
    confidence = serializers.ChoiceField(choices=["certain", "high", "medium"])
    summary = serializers.CharField()
    squares = serializers.ListField(child=serializers.CharField(), max_length=32)
    pieces = serializers.ListField(child=serializers.CharField(), max_length=32)
    evidence = serializers.DictField()


class PositionFeatureSetSerializer(serializers.ModelSerializer):
    schemaVersion = serializers.IntegerField(source="schema_version")
    extractorVersion = serializers.CharField(source="extractor_version")
    facts = PositionFactSerializer(many=True)
    updatedAt = serializers.DateTimeField(source="updated_at")

    class Meta:
        model = PositionFeatureSet
        fields = ["fen", "schemaVersion", "extractorVersion", "facts", "checksum", "updatedAt"]


class PositionFeaturePayloadSerializer(serializers.Serializer):
    fen = serializers.CharField()
    schemaVersion = serializers.IntegerField()
    extractorVersion = serializers.CharField()
    facts = PositionFactSerializer(many=True)
    checksum = serializers.CharField()


class MoveComparisonSerializer(serializers.Serializer):
    originFen = serializers.CharField()
    moveUci = serializers.CharField()
    moveSan = serializers.CharField()
    resultingFen = serializers.CharField()
    before = PositionFeaturePayloadSerializer()
    after = PositionFeaturePayloadSerializer()
    addedFacts = PositionFactSerializer(many=True)
    removedFacts = PositionFactSerializer(many=True)
