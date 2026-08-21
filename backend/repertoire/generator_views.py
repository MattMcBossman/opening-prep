"""Public HTTP wrapper around the offline opening candidate generator."""

from dataclasses import replace
from datetime import timedelta
from pathlib import Path
from threading import Lock
from time import monotonic, time

import chess
from django.conf import settings
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.tokens import get_lichess_access_token
from common.fen import normalize_fen
from explorer_cache.cache import params_key_for
from explorer_cache.lichess_token import token_for_user
from explorer_cache.models import EngineLineCache, PositionStatsCache

from .gap_recommender import GapCandidate, discover_module_gaps, rank_gap_candidates
from .opening_generator import (
    ExplorerMove,
    ExplorerPosition,
    GenerationError,
    GenerationResult,
    GeneratorConfig,
    LichessPositionSource,
    RepertoirePositionSource,
    RequestPacer,
    StockfishEvaluator,
    generate_candidate,
    parse_prefix,
)

_generation_progress = {}
_progress_lock = Lock()


def _set_progress(
    progress_id,
    phase,
    message,
    *,
    current=None,
    total=None,
    retry_after=None,
    suggestions=None,
    active_line=None,
    active_base_ply=None,
):
    if not progress_id:
        return
    now = monotonic()
    with _progress_lock:
        for key, value in list(_generation_progress.items()):
            if now - value["updated"] > 600:
                _generation_progress.pop(key, None)
        previous = _generation_progress.get(str(progress_id), {})
        _generation_progress[str(progress_id)] = {
            "phase": phase,
            "message": message,
            "current": current,
            "total": total,
            "retryAtMs": round((time() + retry_after) * 1000) if retry_after else None,
            "suggestions": suggestions if suggestions is not None else previous.get("suggestions", []),
            "activeLineUci": (
                active_line if active_line is not None else previous.get("activeLineUci", [])
            ),
            "activeBasePly": (
                active_base_ply
                if active_base_ply is not None
                else previous.get("activeBasePly", 0)
            ),
            "updated": now,
        }


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
    requestedCoverage = serializers.FloatField(min_value=0.01, max_value=1, default=0.95)
    minimumScore = serializers.FloatField(min_value=0, max_value=80, default=16)
    evaluationWeight = serializers.FloatField(min_value=0, max_value=50, default=6)
    minimumEvaluation = serializers.FloatField(min_value=-20, max_value=20, default=-1)
    progressId = serializers.UUIDField(required=False, write_only=True)

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
        progress_id = values.pop("progressId", None)
        _set_progress(progress_id, "starting", "Preparing the recommendation request…")
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
        population_params_key = params_key_for(
            12,
            speeds=values.get("speeds") or None,
        )
        elite_ratings = "2500"
        elite_params_key = params_key_for(
            12,
            ratings=elite_ratings,
            speeds=values.get("speeds") or None,
        )

        def cached_position(board, params_key):
            row = PositionStatsCache.objects.filter(
                source=PositionStatsCache.SOURCE_LICHESS,
                fen=normalize_fen(board.fen(en_passant="legal")),
                params_key=params_key,
            ).first()
            if row is None:
                return None
            payload = row.response
            moves = tuple(
                ExplorerMove(
                    item["uci"],
                    item["san"],
                    sum(int(item.get(key) or 0) for key in ("white", "draws", "black")),
                )
                for item in payload.get("moves") or []
                if item.get("uci") and item.get("san")
            )
            return ExplorerPosition(
                total_games=sum(int(payload.get(key) or 0) for key in ("white", "draws", "black")),
                moves=tuple(sorted(moves, key=lambda move: (-move.games, move.uci))),
            )

        def store_position(board, payload, params_key):
            PositionStatsCache.objects.update_or_create(
                source=PositionStatsCache.SOURCE_LICHESS,
                fen=normalize_fen(board.fen(en_passant="legal")),
                params_key=params_key,
                defaults={
                    "response": payload,
                    "expires_at": timezone.now()
                    + timedelta(seconds=settings.EXPLORER_CACHE_TTL_SECONDS),
                },
            )

        request_pacer = RequestPacer(5)
        def rate_limit_progress(remaining):
            _set_progress(
                progress_id,
                "rate_limit",
                (
                    f"Lichess asked Mainline to pause. Resuming in {remaining}s…"
                    if remaining
                    else "Pause complete. Retrying Lichess now…"
                ),
                retry_after=remaining,
            )
        population_source = LichessPositionSource(
            settings.LICHESS_EXPLORER_URL,
            token,
            speeds=values.get("speeds") or None,
            moves=12,
            cache_lookup=lambda board: cached_position(board, population_params_key),
            cache_store=lambda board, payload: store_position(board, payload, population_params_key),
            request_pacer=request_pacer,
            on_rate_limit=rate_limit_progress,
        )
        elite_source = LichessPositionSource(
            settings.LICHESS_EXPLORER_URL,
            token,
            ratings=elite_ratings,
            speeds=values.get("speeds") or None,
            moves=12,
            cache_lookup=lambda board: cached_position(board, elite_params_key),
            cache_store=lambda board, payload: store_position(board, payload, elite_params_key),
            request_pacer=request_pacer,
            on_rate_limit=rate_limit_progress,
        )
        source = RepertoirePositionSource(values["color"], elite_source, population_source)
        evaluator = None
        try:
            if stockfish_path:
                _set_progress(progress_id, "engine", "Starting server Stockfish…")
                evaluator = StockfishEvaluator(
                    str(Path(stockfish_path)),
                    values["color"] == "white",
                    depth=values["engineDepth"],
                )
            proposals = []
            _set_progress(
                progress_id,
                "scanning",
                "Reading the selected module and cached evaluations…"
                if values["mode"] == "fill_gaps"
                else "Preparing an empty module at the selected position…",
            )
            existing_paths = [tuple(line) for line in values["existingLines"]]
            if not existing_paths:
                existing_paths = [tuple(values["prefix"])]
            if existing_paths:
                repertoire_fens = set()
                for path in existing_paths:
                    board = chess.Board()
                    repertoire_fens.add(normalize_fen(board.fen(en_passant="legal")))
                    for uci in path:
                        board.push_uci(uci)
                        repertoire_fens.add(normalize_fen(board.fen(en_passant="legal")))
                evaluations = {}
                for row in EngineLineCache.objects.filter(
                    fen__in=repertoire_fens
                ).order_by("fen", "-depth", "-updated_at"):
                    evaluations.setdefault(row.fen, (row.score_type, row.score_value))
                initial = evaluations.get(normalize_fen(chess.Board().fen(en_passant="legal")))
                initial_white_evaluation = (
                    (initial[1] / 100) if initial and initial[0] == "cp" else 0
                )
                _set_progress(progress_id, "scanning", "Checking positions for missing coverage…")
                gaps = discover_module_gaps(
                    existing_paths,
                    tuple(values["prefix"]),
                    values["color"],
                    source,
                    min_games=config.min_games,
                    min_frequency=config.min_frequency,
                    max_opponent_replies=config.max_opponent_replies,
                    requested_coverage=values["requestedCoverage"],
                    evaluations=evaluations,
                    minimum_score=values["minimumScore"],
                    evaluation_weight=values["evaluationWeight"],
                    minimum_evaluation=values["minimumEvaluation"],
                    initial_white_evaluation=initial_white_evaluation,
                )
                generated_candidates = []
                reports = []
                gap_limit = min(len(gaps), values["maxLines"])
                _set_progress(
                    progress_id,
                    "extending",
                    f"Found {len(gaps)} coverage candidates. Building responses…",
                    current=0,
                    total=gap_limit,
                )
                neutral_target_ply = int(
                    values["minimumScore"]
                    - values["evaluationWeight"] * values["minimumEvaluation"]
                    + 0.999999
                )
                # A gap proposal teaches the immediate response plus a short
                # continuation, extending far enough to satisfy the same score
                # threshold as coverage even at the configured evaluation floor.
                for index, gap in enumerate(gaps[: values["maxLines"]], start=1):
                    label = "score-failing line" if gap.kind == "terminal" else "unprepared reply"
                    base_ply = len(gap.path_uci) - (1 if gap.kind == "response" else 0)
                    _set_progress(
                        progress_id,
                        "extending",
                        f"Extending {label} at ply {gap.depth}…",
                        current=index,
                        total=gap_limit,
                        active_line=list(gap.path_uci),
                        active_base_ply=base_ply,
                    )
                    if len(gap.path_uci) >= config.max_ply:
                        continue
                    gap_config = replace(
                        config,
                        max_lines=1,
                        max_ply=min(
                            config.max_ply,
                            max(len(gap.path_uci) + 2, neutral_target_ply),
                        ),
                    )
                    extension = generate_candidate(
                        list(gap.path_uci),
                        gap_config,
                        source,
                        evaluator,
                        on_progress=lambda analyzed, queued, path, candidate_index=index,
                        candidate_base_ply=base_ply: _set_progress(
                            progress_id,
                            "extending",
                            (
                                f"Building candidate {candidate_index}: examining position "
                                f"{analyzed} ({queued} queued)…"
                            ),
                            current=candidate_index,
                            total=gap_limit,
                            active_line=path,
                            active_base_ply=candidate_base_ply,
                        ),
                    )
                    reports.extend(extension.reports)
                    if not extension.lines or len(extension.lines[0]) <= len(gap.path_uci):
                        continue
                    path = tuple(extension.lines[0])
                    board = chess.Board()
                    for uci in path:
                        board.push_uci(uci)
                    engine_loss = None
                    response_report = extension.reports[0] if extension.reports else None
                    scored = [
                        move.get("scoreCp")
                        for move in [
                            *(response_report.included if response_report else []),
                            *(response_report.omitted if response_report else []),
                        ]
                        if move.get("scoreCp") is not None
                    ]
                    chosen_score = (
                        response_report.included[0].get("scoreCp")
                        if response_report and response_report.included
                        else None
                    )
                    if chosen_score is not None and scored:
                        engine_loss = max(scored) - chosen_score
                    response_rate = gap.response_rate
                    move_games = gap.move_games
                    if gap.kind == "terminal" and response_report and response_report.included:
                        response_rate *= response_report.included[0].get("frequency", 0)
                        move_games = response_report.included[0].get("games", move_games)
                    generated_candidates.append(GapCandidate(
                        id=gap.id,
                        gap_key=gap.gap_key,
                        path_uci=path,
                        resulting_fen=board.fen(en_passant="legal"),
                        reach_rate=gap.reach_rate,
                        response_rate=response_rate,
                        move_games=move_games,
                        engine_loss_cp=engine_loss,
                        depth=gap.depth,
                        gap_missing_rate=gap.gap_missing_rate,
                        kind=gap.kind,
                        base_ply=base_ply,
                    ))
                    partial_proposals = rank_gap_candidates(
                        generated_candidates,
                        existing_paths,
                        repertoire_fens,
                        move_budget=values["moveBudget"],
                        max_engine_loss_cp=values["maxEngineLossCp"],
                    )
                    _set_progress(
                        progress_id,
                        "extending",
                        f"Checked {index} candidates; {len(partial_proposals)} lines suggested so far.",
                        current=index,
                        total=gap_limit,
                        suggestions=[proposal.payload() for proposal in partial_proposals],
                    )
                _set_progress(progress_id, "ranking", "Ranking coverage gain against new-move cost…")
                proposals = rank_gap_candidates(
                    generated_candidates,
                    existing_paths,
                    repertoire_fens,
                    move_budget=values["moveBudget"],
                    max_engine_loss_cp=values["maxEngineLossCp"],
                )
                result = GenerationResult(
                    name=config.name,
                    color=config.color,
                    prefix_uci=list(values["prefix"]),
                    lines=[list(proposal.candidate.path_uci) for proposal in proposals],
                    reports=reports,
                    settings={
                        **config.__dict__,
                        "requested_coverage": values["requestedCoverage"],
                        "minimum_score": values["minimumScore"],
                        "evaluation_weight": values["evaluationWeight"],
                        "minimum_evaluation": values["minimumEvaluation"],
                    },
                    engine=evaluator.name if evaluator else None,
                )
        except GenerationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        finally:
            if evaluator:
                evaluator.close()

        _set_progress(progress_id, "complete", "Building the review preview…")
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


class OpeningGenerationProgressView(APIView):
    permission_classes = [AllowAny]

    def get(self, _request, progress_id):
        with _progress_lock:
            progress = _generation_progress.get(str(progress_id))
        if progress is None:
            return Response({"detail": "Generation has not started."}, status=404)
        return Response({key: value for key, value in progress.items() if key != "updated"})
