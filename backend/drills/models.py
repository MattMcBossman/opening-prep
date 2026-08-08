"""Persistent drill sessions, per-attempt history, and weakness aggregates."""

from django.conf import settings
from django.db import models


class DrillSession(models.Model):
    """
    One run through `useDrillSession` (frontend/src/hooks/useDrillSession.ts),
    from "start" to either "finish" or abandonment.

    Deleting a repertoire takes its drill history with it: these statistics are
    per-position records of practising *that* repertoire's lines, and are
    meaningless once the lines are gone. The field is named `repertoire` but
    still backed by the `repertoire_id` column, so `session.repertoire_id` and
    `session__repertoire_id` lookups read naturally either way.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="drill_sessions"
    )
    repertoire = models.ForeignKey(
        "repertoire.Repertoire", on_delete=models.CASCADE, related_name="drill_sessions"
    )
    is_retry_pass = models.BooleanField(default=False)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at"]
        indexes = [models.Index(fields=["user", "repertoire"])]

    def __str__(self) -> str:
        return f"DrillSession({self.id}) user={self.user_id} repertoire={self.repertoire_id}"


class DrillLineResult(models.Model):
    """
    The outcome of one drill line (one leaf-to-root path - see `DrillLine` in
    `frontend/src/lib/repertoireDrills.ts`) within a session, recorded when the
    session finishes.
    """

    OUTCOME_PERFECT = "perfect"
    OUTCOME_FAILED = "failed"
    OUTCOME_CHOICES = [(OUTCOME_PERFECT, "Perfect"), (OUTCOME_FAILED, "Failed")]

    session = models.ForeignKey(DrillSession, on_delete=models.CASCADE, related_name="line_results")
    # The UCI path used as `DrillLine.id` client-side, e.g. "e2e4 e7e5 g1f3".
    line_id = models.CharField(max_length=255)
    outcome = models.CharField(max_length=8, choices=OUTCOME_CHOICES)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["session", "line_id"], name="unique_drill_line_result_per_session"
            )
        ]

    def __str__(self) -> str:
        return f"{self.line_id}: {self.outcome}"


class DrillAttempt(models.Model):
    """
    One played move during a drill session - the raw source of truth that both
    `DrillLineResult` and the `/drills/stats/` aggregates are derived from (see
    API_CONTRACT.md; a future spaced-repetition scheduler reads the aggregate,
    not this table directly).
    """

    session = models.ForeignKey(DrillSession, on_delete=models.CASCADE, related_name="attempts")
    # Normalized (see common.fen.normalize_fen) - the repertoire's own position identity.
    origin_fen = models.CharField(max_length=100)
    played_uci = models.CharField(max_length=8)
    is_correct = models.BooleanField()
    # 1-based count of wrong attempts at this position so far this occurrence -
    # mirrors `DrillSessionState.wrongAttempts` in drillSessionLogic.ts.
    attempt_number = models.PositiveSmallIntegerField()
    # Both null for a correct move, and for a wrong move until the async engine
    # comparison resolves - see `DrillFeedback.cpLoss`/`isBad` in
    # drillSessionLogic.ts, which are optional for exactly the same reason.
    cp_loss = models.IntegerField(null=True, blank=True)
    is_bad = models.BooleanField(null=True, blank=True)
    # The line this attempt occurred within (DrillLine.id) - lets the stats
    # aggregate distinguish attempts belonging to different occurrences of the
    # same position across sibling lines, if ever needed, without re-deriving
    # it from ordering.
    line_id = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["session", "origin_fen"])]

    def __str__(self) -> str:
        return f"{self.origin_fen} -> {self.played_uci} ({'ok' if self.is_correct else 'wrong'})"
