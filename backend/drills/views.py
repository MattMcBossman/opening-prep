"""DRF views for the drills app. See backend/API_CONTRACT.md for the endpoints."""

from django.db.models import Count, Max, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from common.fen import normalize_fen

from .models import DrillAttempt, DrillLineResult, DrillSession
from .repertoire_link import resolve_repertoire_id
from .serializers import (
    DrillAttemptsBatchSerializer,
    DrillFinishSerializer,
    DrillSessionCreatedSerializer,
    DrillSessionCreateSerializer,
    DrillSessionSummarySerializer,
    DrillStatsQuerySerializer,
    PositionStatSerializer,
)


def _with_outcome_counts(queryset):
    """Annotates `perfect`/`failed` line-result counts, shared by the list and finish responses."""
    return queryset.annotate(
        perfect=Count("line_results", filter=Q(line_results__outcome=DrillLineResult.OUTCOME_PERFECT)),
        failed=Count("line_results", filter=Q(line_results__outcome=DrillLineResult.OUTCOME_FAILED)),
    )


class DrillSessionListCreateView(APIView):
    """`GET`/`POST /drills/sessions/` - see API_CONTRACT.md."""

    def get(self, request):
        sessions = _with_outcome_counts(DrillSession.objects.filter(user=request.user))
        return Response(DrillSessionSummarySerializer(sessions, many=True).data)

    def post(self, request):
        body = DrillSessionCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)

        repertoire_id = resolve_repertoire_id(body.validated_data["repertoireId"], request.user)
        session = DrillSession.objects.create(
            user=request.user,
            repertoire_id=repertoire_id,
            is_retry_pass=body.validated_data["is_retry_pass"],
        )
        return Response(DrillSessionCreatedSerializer(session).data, status=201)


class DrillAttemptsView(APIView):
    """`POST /drills/sessions/{id}/attempts/` - see API_CONTRACT.md."""

    def post(self, request, session_id):
        session = get_object_or_404(DrillSession, id=session_id, user=request.user)

        body = DrillAttemptsBatchSerializer(data=request.data)
        body.is_valid(raise_exception=True)

        DrillAttempt.objects.bulk_create(
            DrillAttempt(
                session=session,
                origin_fen=normalize_fen(item["origin_fen"]),
                played_uci=item["played_uci"],
                is_correct=item["is_correct"],
                attempt_number=item["attempt_number"],
                cp_loss=item.get("cp_loss"),
                is_bad=item.get("is_bad"),
                line_id=item["line_id"],
            )
            for item in body.validated_data["attempts"]
        )
        return Response(status=204)


class DrillFinishView(APIView):
    """`POST /drills/sessions/{id}/finish/` - see API_CONTRACT.md."""

    def post(self, request, session_id):
        session = get_object_or_404(DrillSession, id=session_id, user=request.user)

        # Idempotent: a retried request after the response was lost shouldn't
        # reprocess or duplicate line results - just hand back what's already there.
        if session.finished_at is None:
            body = DrillFinishSerializer(data=request.data)
            body.is_valid(raise_exception=True)

            DrillLineResult.objects.bulk_create(
                (
                    DrillLineResult(session=session, line_id=item["line_id"], outcome=item["outcome"])
                    for item in body.validated_data["results"]
                ),
                ignore_conflicts=True,
            )
            session.finished_at = timezone.now()
            session.save(update_fields=["finished_at"])

        session = _with_outcome_counts(DrillSession.objects.filter(id=session.id)).get()
        return Response(DrillSessionSummarySerializer(session).data)


class DrillStatsView(APIView):
    """`GET /drills/stats/?repertoire=<id>` - see API_CONTRACT.md."""

    def get(self, request):
        query = DrillStatsQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)

        attempts = DrillAttempt.objects.filter(session__user=request.user)
        repertoire_id = query.validated_data.get("repertoire")
        if repertoire_id is not None:
            attempts = attempts.filter(session__repertoire_id=repertoire_id)

        aggregates = list(
            attempts.values("origin_fen").annotate(
                attempts=Count("id"),
                mistakes=Count("id", filter=Q(is_correct=False)),
                last_seen_at=Max("created_at"),
            )
        )
        # Sorted here rather than via a second `.annotate()` on top of the
        # aggregate one above - portable across DB backends, and there's no
        # real cost: the number of distinct positions per user/repertoire is
        # small enough this is never worth pushing into SQL.
        aggregates.sort(key=lambda row: (row["mistakes"] / row["attempts"], row["attempts"]), reverse=True)
        return Response(PositionStatSerializer(aggregates, many=True).data)
