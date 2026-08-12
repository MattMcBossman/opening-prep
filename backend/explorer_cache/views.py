"""DRF views for the explorer_cache app. See backend/API_CONTRACT.md for the endpoints."""

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import analysis_cache, cache, feature_cache, game_exports
from .position_features import compare_position_features
from .serializers import (
    EngineEvalQuerySerializer,
    EngineEvaluationSerializer,
    ExplorerResponseSerializer,
    ExplorerStatsQuerySerializer,
    MoveComparisonQuerySerializer,
    MoveComparisonSerializer,
    PositionAnalysisQuerySerializer,
    PositionAnalysisSerializer,
    PositionAnalysisUploadSerializer,
    PositionFeatureQuerySerializer,
    PositionFeatureSetSerializer,
    derive_recurring_moves,
)

# DRF's default `{"detail": "..."}` error body, shared by every non-2xx response below.
_DETAIL_SCHEMA = {"type": "object", "properties": {"detail": {"type": "string"}}, "required": ["detail"]}
NO_TOKEN_RESPONSE = OpenApiResponse(
    response=_DETAIL_SCHEMA, description="No Lichess API token on file for this user."
)
RATE_LIMITED_RESPONSE = OpenApiResponse(
    response=_DETAIL_SCHEMA,
    description="Lichess rate-limited this request; see the `Retry-After` header when present.",
)
UPSTREAM_UNAVAILABLE_RESPONSE = OpenApiResponse(
    response=_DETAIL_SCHEMA, description="The Lichess explorer is currently unavailable."
)
NOT_CACHED_RESPONSE = OpenApiResponse(
    response=_DETAIL_SCHEMA, description="No cached evaluation for this position."
)


class ExplorerStatsView(APIView):
    """`GET /explorer/stats/?fen=...&moves=...` - see API_CONTRACT.md."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "explorer"

    @extend_schema(
        summary="Fetch (or populate) cached Lichess opening-explorer stats for a position.",
        description=(
            "Single-flight per FEN via a Postgres advisory lock: concurrent requests for the same "
            "position share one upstream fetch instead of each hitting Lichess. Requires the caller "
            "to have a Lichess API token on file - anonymous browsing without one is not supported."
        ),
        parameters=[ExplorerStatsQuerySerializer],
        responses={
            200: ExplorerResponseSerializer,
            401: NO_TOKEN_RESPONSE,
            429: RATE_LIMITED_RESPONSE,
            502: UPSTREAM_UNAVAILABLE_RESPONSE,
        },
    )
    def get(self, request):
        query = ExplorerStatsQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        data_in = query.validated_data

        try:
            data = cache.get_or_fetch_stats(
                data_in["fen"],
                data_in["moves"],
                request.user,
                since=data_in.get("since"),
                until=data_in.get("until"),
                ratings=data_in.get("ratings"),
                speeds=data_in.get("speeds"),
            )
        except cache.TokenRequired:
            return Response({"detail": "Sign in with Lichess to load explorer stats."}, status=401)
        except cache.UpstreamRateLimited as exc:
            headers = {"Retry-After": exc.retry_after} if exc.retry_after else {}
            return Response({"detail": "Lichess rate-limited this request."}, status=429, headers=headers)
        except cache.UpstreamUnavailable:
            return Response({"detail": "The Lichess explorer is currently unavailable."}, status=502)

        return Response(ExplorerResponseSerializer(data).data)


class PersonalGameExportView(APIView):
    """Stream source game records for the browser's persistent opening index."""

    @extend_schema(exclude=True)
    def get(self, request, source: str):
        try:
            since_ms = int(request.query_params["since"]) if request.query_params.get("since") else None
        except ValueError:
            return Response({"detail": "since must be a Unix timestamp in milliseconds."}, status=400)
        try:
            if source == "lichess":
                return game_exports.stream_lichess_games(request.user, since_ms)
            if source == "chesscom":
                return game_exports.stream_chesscom_games(request.user, since_ms)
            return Response({"detail": "Unknown game source."}, status=404)
        except cache.TokenRequired:
            return Response({"detail": f"Link your {source} account first."}, status=401)
        except cache.UpstreamRateLimited as exc:
            headers = {"Retry-After": exc.retry_after} if exc.retry_after else {}
            return Response({"detail": f"{source} rate-limited this request."}, status=429, headers=headers)
        except cache.UpstreamUnavailable:
            return Response({"detail": f"{source} game export is unavailable."}, status=502)


class EngineEvalView(APIView):
    """`GET`/`PUT /explorer/evals/` - see API_CONTRACT.md. Authenticated (the default)."""

    @extend_schema(
        summary="Fetch the cached engine evaluation for a position, if one exists.",
        parameters=[EngineEvalQuerySerializer],
        responses={200: EngineEvaluationSerializer, 404: NOT_CACHED_RESPONSE},
    )
    def get(self, request):
        query = EngineEvalQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)

        entry = cache.get_cached_eval(query.validated_data["fen"], query.validated_data["engineVersion"])
        if entry is None:
            return Response({"detail": "No cached evaluation for this position."}, status=404)
        return Response(EngineEvaluationSerializer(entry).data)

    @extend_schema(
        summary="Upsert an engine evaluation, keeping the deepest line seen per FEN.",
        description="A shallower `depth` than what's already cached for this FEN is accepted but ignored.",
        request=EngineEvaluationSerializer,
        responses={200: EngineEvaluationSerializer},
    )
    def put(self, request):
        body = EngineEvaluationSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data

        entry, _ = cache.upsert_engine_line(
            fen=data["fen"],
            engine_version=data["engine_version"],
            depth=data["depth"],
            score_type=data["score_type"],
            score_value=data["score_value"],
            best_move_uci=data.get("best_move_uci"),
            pv_uci=data.get("pv_uci") or [],
        )
        return Response(EngineEvaluationSerializer(entry).data)


class PositionAnalysisView(APIView):
    """Authenticated shared objective MultiPV cache."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "position_analysis"

    @extend_schema(
        summary="Fetch a compatible cached position analysis.",
        parameters=[PositionAnalysisQuerySerializer],
        responses={200: PositionAnalysisSerializer, 404: NOT_CACHED_RESPONSE},
    )
    def get(self, request):
        query = PositionAnalysisQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        data = query.validated_data
        entry = analysis_cache.get_position_analysis(
            data["fen"], data["engineVersion"], data["analysisProfile"]
        )
        if entry is None:
            return Response({"detail": "No cached position analysis."}, status=404)
        return Response(PositionAnalysisSerializer(entry).data)

    @extend_schema(
        summary="Upsert a validated browser-computed MultiPV position analysis.",
        request=PositionAnalysisUploadSerializer,
        responses={200: PositionAnalysisSerializer},
    )
    def put(self, request):
        body = PositionAnalysisUploadSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        candidates = data["candidates"]
        recurring_moves = derive_recurring_moves(data["fen"], candidates)
        entry, _ = analysis_cache.upsert_position_analysis(
            fen=data["fen"],
            engine_version=data["engineVersion"],
            analysis_profile=data["analysisProfile"],
            candidates=candidates,
            recurring_moves=recurring_moves,
        )
        return Response(PositionAnalysisSerializer(entry).data)


class PositionFeatureSetView(APIView):
    """Public deterministic facts computed solely from the requested board."""

    permission_classes = [AllowAny]

    @extend_schema(
        summary="Fetch versioned concrete board facts for a position.",
        parameters=[PositionFeatureQuerySerializer],
        responses={200: PositionFeatureSetSerializer},
    )
    def get(self, request):
        query = PositionFeatureQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        entry = feature_cache.get_or_create_position_features(query.validated_data["fen"])
        return Response(PositionFeatureSetSerializer(entry).data)


class MoveComparisonView(APIView):
    """Public deterministic fact diff for a legal move from a position."""

    permission_classes = [AllowAny]

    @extend_schema(
        summary="Compare concrete board facts before and after a legal move.",
        parameters=[MoveComparisonQuerySerializer],
        responses={200: MoveComparisonSerializer},
    )
    def get(self, request):
        query = MoveComparisonQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        try:
            comparison = compare_position_features(query.validated_data["fen"], query.validated_data["move"])
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(MoveComparisonSerializer(comparison).data)
