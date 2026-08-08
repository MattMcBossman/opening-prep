"""DRF views for the explorer_cache app. See backend/API_CONTRACT.md for the endpoints."""

from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import cache
from .serializers import (
    EngineEvalQuerySerializer,
    EngineEvaluationSerializer,
    ExplorerResponseSerializer,
    ExplorerStatsQuerySerializer,
)


class ExplorerStatsView(APIView):
    """`GET /explorer/stats/?fen=...&moves=...` - see API_CONTRACT.md."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "explorer"

    def get(self, request):
        query = ExplorerStatsQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)

        try:
            data = cache.get_or_fetch_stats(
                query.validated_data["fen"], query.validated_data["moves"], request.user
            )
        except cache.TokenRequired:
            return Response({"detail": "Sign in with Lichess to load explorer stats."}, status=401)
        except cache.UpstreamRateLimited as exc:
            headers = {"Retry-After": exc.retry_after} if exc.retry_after else {}
            return Response({"detail": "Lichess rate-limited this request."}, status=429, headers=headers)
        except cache.UpstreamUnavailable:
            return Response({"detail": "The Lichess explorer is currently unavailable."}, status=502)

        return Response(ExplorerResponseSerializer(data).data)


class EngineEvalView(APIView):
    """`GET`/`PUT /explorer/evals/` - see API_CONTRACT.md. Authenticated (the default)."""

    def get(self, request):
        query = EngineEvalQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)

        entry = cache.get_cached_eval(query.validated_data["fen"])
        if entry is None:
            return Response({"detail": "No cached evaluation for this position."}, status=404)
        return Response(EngineEvaluationSerializer(entry).data)

    def put(self, request):
        body = EngineEvaluationSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data

        entry, _ = cache.upsert_engine_line(
            fen=data["fen"],
            depth=data["depth"],
            score_type=data["score_type"],
            score_value=data["score_value"],
            best_move_uci=data.get("best_move_uci"),
            pv_uci=data.get("pv_uci") or [],
        )
        return Response(EngineEvaluationSerializer(entry).data)
