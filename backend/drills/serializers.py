"""DRF serializers for the drills app. See backend/API_CONTRACT.md for the shapes."""

from rest_framework import serializers

from .models import DrillLineResult


class DrillSessionCreateSerializer(serializers.Serializer):
    """Body for `POST /drills/sessions/`."""

    repertoireId = serializers.IntegerField(required=False)
    repertoireIds = serializers.ListField(child=serializers.IntegerField(min_value=1), required=False)
    templateReleaseIds = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, default=list
    )
    isRetryPass = serializers.BooleanField(source="is_retry_pass", required=False, default=False)
    startMode = serializers.ChoiceField(
        source="start_mode", choices=["beginning", "selected_position"], default="beginning"
    )
    selectedFen = serializers.CharField(source="selected_fen", required=False, allow_null=True, default=None)
    selectedPly = serializers.IntegerField(
        source="selected_ply", required=False, allow_null=True, min_value=0, default=None
    )
    prefixUci = serializers.ListField(
        source="prefix_uci", child=serializers.CharField(max_length=8), required=False, default=list
    )

    def validate(self, attrs):
        ids = attrs.get("repertoireIds", [])
        legacy = attrs.get("repertoireId")
        if legacy is not None:
            ids = [legacy, *ids]
        attrs["repertoireIds"] = list(dict.fromkeys(ids))
        if not attrs["repertoireIds"] and not attrs["templateReleaseIds"]:
            raise serializers.ValidationError("At least one drill source is required.")
        if attrs["start_mode"] == "selected_position" and attrs["selected_fen"] is None:
            raise serializers.ValidationError({"selectedFen": "Required for selected-position drills."})
        return attrs


class DrillSessionCreatedSerializer(serializers.Serializer):
    """Response for `POST /drills/sessions/` - just enough for the client to start logging attempts."""

    id = serializers.IntegerField()
    startedAt = serializers.DateTimeField(source="started_at")


class DrillSessionSummarySerializer(serializers.Serializer):
    """
    Shared shape for `GET /drills/sessions/` (list) and `POST
    /drills/sessions/{id}/finish/` (single). Expects `perfect`/`failed` to
    already be annotated onto the queryset/instance - see views.py.
    """

    id = serializers.IntegerField()
    startedAt = serializers.DateTimeField(source="started_at")
    finishedAt = serializers.DateTimeField(source="finished_at", allow_null=True)
    isRetryPass = serializers.BooleanField(source="is_retry_pass")
    perfect = serializers.IntegerField()
    failed = serializers.IntegerField()


class DrillAttemptInputSerializer(serializers.Serializer):
    """One entry of the `attempts` batch for `POST /drills/sessions/{id}/attempts/`."""

    originFen = serializers.CharField(source="origin_fen")
    playedUci = serializers.CharField(source="played_uci", max_length=8)
    isCorrect = serializers.BooleanField(source="is_correct")
    attemptNumber = serializers.IntegerField(source="attempt_number", min_value=1)
    # Optional: only exist once the async engine comparison resolves, and never
    # for a correct move at all - see DrillFeedback.cpLoss/isBad in
    # frontend/src/lib/drillSessionLogic.ts.
    cpLoss = serializers.IntegerField(source="cp_loss", required=False, allow_null=True)
    isBad = serializers.BooleanField(source="is_bad", required=False, allow_null=True)
    lineId = serializers.CharField(source="line_id")


class DrillAttemptsBatchSerializer(serializers.Serializer):
    attempts = DrillAttemptInputSerializer(many=True, allow_empty=False)


class DrillLineResultInputSerializer(serializers.Serializer):
    """One entry of the `results` list for `POST /drills/sessions/{id}/finish/`."""

    lineId = serializers.CharField(source="line_id")
    outcome = serializers.ChoiceField(choices=DrillLineResult.OUTCOME_CHOICES)


class DrillFinishSerializer(serializers.Serializer):
    results = DrillLineResultInputSerializer(many=True, allow_empty=False)


class DrillStatsQuerySerializer(serializers.Serializer):
    repertoire = serializers.IntegerField(required=False)


class PositionStatSerializer(serializers.Serializer):
    """One row of `GET /drills/stats/` - a per-position weakness aggregate."""

    originFen = serializers.CharField(source="origin_fen")
    attempts = serializers.IntegerField()
    mistakes = serializers.IntegerField()
    lastSeenAt = serializers.DateTimeField(source="last_seen_at")
