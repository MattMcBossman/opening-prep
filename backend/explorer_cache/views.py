"""DRF views for the explorer_cache app. See backend/API_CONTRACT.md for the endpoints."""

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import cache, player_stats
from .serializers import (
    EngineEvalQuerySerializer,
    EngineEvaluationSerializer,
    ExplorerResponseSerializer,
    ExplorerStatsQuerySerializer,
    MyGamesExplorerQuerySerializer,
    MyGamesExplorerResponseSerializer,
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


class MyGamesExplorerView(APIView):
    """`GET /explorer/my-games/?fen=...&color=...&moves=...` - see API_CONTRACT.md.

    Authenticated (the default): unlike `/explorer/stats/`, this always needs
    the caller's own linked Lichess account (both to know which player to
    query and to authenticate the request), so there is no anonymous path.
    Deliberately uncached - see player_stats.py.
    """

    @extend_schema(
        summary="Opening-tree stats from the signed-in user's own Lichess games.",
        description=(
            "Live proxy for Lichess's player-scoped opening explorer - never cached, since this is "
            "per-user data. `color` is the color the signed-in user played (matching the app's "
            "White/Black repertoire toggle), not whose turn it is at `fen`. May return "
            "`stillIndexing: true` with a best-effort partial result if Lichess hasn't finished "
            "processing the account's games yet."
        ),
        parameters=[MyGamesExplorerQuerySerializer],
        responses={
            200: MyGamesExplorerResponseSerializer,
            401: NO_TOKEN_RESPONSE,
            429: RATE_LIMITED_RESPONSE,
            502: UPSTREAM_UNAVAILABLE_RESPONSE,
        },
    )
    def get(self, request):
        query = MyGamesExplorerQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        data_in = query.validated_data

        try:
            data = player_stats.fetch_player_stats(
                request.user,
                data_in["fen"],
                data_in["moves"],
                data_in["color"],
                since=data_in.get("since"),
                until=data_in.get("until"),
            )
        except cache.TokenRequired:
            return Response(
                {"detail": "Link your Lichess account to see stats from your own games."}, status=401
            )
        except cache.UpstreamRateLimited as exc:
            headers = {"Retry-After": exc.retry_after} if exc.retry_after else {}
            return Response({"detail": "Lichess rate-limited this request."}, status=429, headers=headers)
        except cache.UpstreamUnavailable:
            return Response({"detail": "The Lichess explorer is currently unavailable."}, status=502)

        return Response(MyGamesExplorerResponseSerializer(data).data)


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

        entry = cache.get_cached_eval(query.validated_data["fen"])
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
            depth=data["depth"],
            score_type=data["score_type"],
            score_value=data["score_value"],
            best_move_uci=data.get("best_move_uci"),
            pv_uci=data.get("pv_uci") or [],
        )
        return Response(EngineEvaluationSerializer(entry).data)
