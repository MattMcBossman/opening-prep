"""Public HTTP wrapper around the offline opening candidate generator."""

from pathlib import Path

import chess
from django.conf import settings
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.tokens import get_lichess_access_token
from explorer_cache.lichess_token import token_for_user

from .gap_recommender import candidates_from_generated_tree, rank_gap_candidates
from .opening_generator import (
    GenerationError,
    GeneratorConfig,
    LichessPositionSource,
    StockfishEvaluator,
    generate_candidate,
    parse_prefix,
)


class OpeningGenerationRequestSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    color = serializers.ChoiceField(choices=("white", "black"))
    prefix = serializers.ListField(child=serializers.CharField(max_length=16), allow_empty=False)
    coverage = serializers.FloatField(min_value=0.01, max_value=1, default=0.60)
    maxLines = serializers.IntegerField(min_value=1, max_value=250, default=50)
    maxPly = serializers.IntegerField(min_value=2, max_value=80, default=24)
    minGames = serializers.IntegerField(min_value=1, default=20)
    minFrequency = serializers.FloatField(min_value=0, max_value=1, default=0.01)
    maxOpponentReplies = serializers.IntegerField(min_value=1, max_value=30, default=8)
    useEngine = serializers.BooleanField(default=False)
    engineDepth = serializers.IntegerField(min_value=1, max_value=40, default=16)
    maxEngineLossCp = serializers.IntegerField(min_value=0, max_value=500, default=35)
    engineCandidates = serializers.IntegerField(min_value=1, max_value=15, default=5)
    ratings = serializers.CharField(required=False, allow_blank=True, max_length=100)
    speeds = serializers.CharField(required=False, allow_blank=True, max_length=100)
    lichessToken = serializers.CharField(required=False, allow_blank=True, write_only=True)
    mode = serializers.ChoiceField(choices=("new_tree", "fill_gaps"), default="new_tree")
    existingLines = serializers.ListField(
        child=serializers.ListField(child=serializers.CharField(max_length=16)),
        required=False,
        default=list,
        write_only=True,
    )
    moveBudget = serializers.IntegerField(min_value=1, max_value=500, default=50)

    def validate_prefix(self, value):
        try:
            _, uci = parse_prefix(value)
        except GenerationError as exc:
            raise serializers.ValidationError(str(exc)) from exc
        return uci

    def validate(self, attrs):
        if len(attrs["prefix"]) >= attrs["maxPly"]:
            raise serializers.ValidationError({"maxPly": "Must extend beyond the selected position."})
        normalized = []
        for line in attrs["existingLines"]:
            try:
                _, uci = parse_prefix(line)
            except GenerationError as exc:
                raise serializers.ValidationError({"existingLines": str(exc)}) from exc
            normalized.append(uci)
        attrs["existingLines"] = normalized
        if attrs["mode"] == "fill_gaps" and not normalized:
            raise serializers.ValidationError(
                {"existingLines": "Gap filling needs existing repertoire lines."}
            )
        return attrs


class OpeningGenerationResponseSerializer(serializers.Serializer):
    name = serializers.CharField()
    color = serializers.CharField()
    prefixUci = serializers.ListField(child=serializers.CharField())
    leafCount = serializers.IntegerField()
    pgn = serializers.CharField()
    report = serializers.JSONField()
    proposals = serializers.JSONField(required=False)


class OpeningGenerationView(APIView):
    """Generate one review candidate; intentionally does not publish it."""

    permission_classes = [AllowAny]

    @extend_schema(
        summary="Generate a personal opening-module PGN candidate.",
        request=OpeningGenerationRequestSerializer,
        responses={200: OpeningGenerationResponseSerializer},
    )
    def post(self, request):
        body = OpeningGenerationRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        values = body.validated_data
        supplied_token = values.pop("lichessToken", "").strip()
        linked_token = (
            get_lichess_access_token(request.user)
            if request.user.is_authenticated and not supplied_token
            else None
        )
        token = supplied_token or linked_token or token_for_user(None)
        if not token:
            return Response(
                {
                    "detail": (
                        "Connect Lichess, enter a Lichess token, or configure "
                        "LICHESS_SERVER_TOKEN before generating."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        stockfish_path = getattr(settings, "OPENING_GENERATOR_STOCKFISH_PATH", "").strip()
        if values["useEngine"] and not stockfish_path:
            return Response(
                {
                    "detail": (
                        "Engine filtering is unavailable until "
                        "OPENING_GENERATOR_STOCKFISH_PATH is configured."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        config = GeneratorConfig(
            name=values["name"],
            color=values["color"],
            coverage=values["coverage"],
            max_lines=values["maxLines"],
            max_ply=values["maxPly"],
            min_games=values["minGames"],
            min_frequency=values["minFrequency"],
            max_opponent_replies=values["maxOpponentReplies"],
            max_engine_loss_cp=values["maxEngineLossCp"],
            engine_candidates=values["engineCandidates"],
        )
        source = LichessPositionSource(
            settings.LICHESS_EXPLORER_URL,
            token,
            ratings=values.get("ratings") or None,
            speeds=values.get("speeds") or None,
        )
        evaluator = None
        try:
            if values["useEngine"]:
                evaluator = StockfishEvaluator(
                    str(Path(stockfish_path)),
                    values["color"] == "white",
                    depth=values["engineDepth"],
                )
            result = generate_candidate(values["prefix"], config, source, evaluator)
            proposals = []
            if values["mode"] == "fill_gaps":
                existing_paths = [tuple(line) for line in values["existingLines"]]
                repertoire_fens = set()
                for path in existing_paths:
                    board = chess.Board()
                    repertoire_fens.add(board.fen(en_passant="legal"))
                    for uci in path:
                        board.push_uci(uci)
                        repertoire_fens.add(board.fen(en_passant="legal"))
                proposals = rank_gap_candidates(
                    candidates_from_generated_tree(result, existing_paths),
                    existing_paths,
                    repertoire_fens,
                    move_budget=values["moveBudget"],
                    max_engine_loss_cp=values["maxEngineLossCp"],
                )
                result.lines = [list(proposal.candidate.path_uci) for proposal in proposals]
        except GenerationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        finally:
            if evaluator:
                evaluator.close()

        return Response(
            {
                "name": result.name,
                "color": result.color,
                "prefixUci": result.prefix_uci,
                "leafCount": len(result.lines),
                "pgn": result.pgn(),
                "report": result.report_payload(),
                "proposals": [proposal.payload() for proposal in proposals],
            }
        )
