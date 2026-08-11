"""FEN-keyed cache of Lichess explorer responses and engine evaluations."""

from django.db import models
from django.utils import timezone


class PositionStatsCache(models.Model):
    """
    A cached upstream explorer response (currently only Lichess, hence `source`
    rather than hard-coding it) for one normalized position.

    Keyed on `(source, fen, params_key)` rather than just `(source, fen)`:
    AGENTS.md plans a rating-band filter on top of this same endpoint, and an
    unkeyed cache would silently serve all-rating data for a filtered request
    (or vice versa) once that ships. `params_key` is a stable hash of every
    query option that changes the upstream response (see `params_key_for` in
    `explorer_cache/cache.py`) so today's single `moves` option and tomorrow's
    rating bands both key correctly without a schema change.
    """

    SOURCE_LICHESS = "lichess"
    SOURCE_CHOICES = [(SOURCE_LICHESS, "Lichess")]

    source = models.CharField(max_length=16, choices=SOURCE_CHOICES, default=SOURCE_LICHESS)
    # Normalized (see common.fen.normalize_fen) - the repertoire's own position identity.
    fen = models.CharField(max_length=100)
    params_key = models.CharField(max_length=64)
    # The upstream response, stored verbatim. Reshaping into ExplorerResponse
    # happens at read time, so a shape change there never needs a backfill.
    response = models.JSONField()
    fetched_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["source", "fen", "params_key"], name="unique_position_stats_cache_key"
            )
        ]
        indexes = [models.Index(fields=["source", "fen", "params_key"])]

    def __str__(self) -> str:
        return f"{self.source}:{self.fen}:{self.params_key}"

    @property
    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at


class EngineLineCache(models.Model):
    """
    A client-submitted Stockfish evaluation for one normalized position.

    Only ever holds the single deepest evaluation seen for a FEN/build pair - see
    `explorer_cache/cache.py`'s `upsert_engine_line`, which mirrors the
    keep-deepest logic in the client's iterative-deepening cache
    (`frontend/src/hooks/useEngineEval.ts`). There is deliberately no `engine`
    engine-build identity so an upgrade never silently reuses an evaluation
    produced by different code or settings.
    """

    SCORE_CP = "cp"
    SCORE_MATE = "mate"
    SCORE_TYPE_CHOICES = [(SCORE_CP, "Centipawns"), (SCORE_MATE, "Mate")]

    fen = models.CharField(max_length=100)
    engine_version = models.CharField(max_length=64, default="stockfish-18-lite-single")
    depth = models.PositiveSmallIntegerField()
    score_type = models.CharField(max_length=8, choices=SCORE_TYPE_CHOICES)
    score_value = models.IntegerField()
    # `null=True` is deliberate here (usually discouraged for CharField):
    # `None` distinguishes "no legal move" (a checkmated/stalemated position)
    # from any real UCI string, which an empty-string sentinel couldn't.
    best_move_uci = models.CharField(max_length=8, null=True, blank=True)  # noqa: DJ001
    # Stored as a JSON array of UCI strings rather than a delimited string -
    # there's no natural separator that can't theoretically collide, and every
    # consumer (Python and the DRF JSON renderer) wants a list anyway.
    pv_uci = models.JSONField(default=list, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["fen", "engine_version"], name="unique_engine_line_cache_key")
        ]
        indexes = [models.Index(fields=["fen", "engine_version"], name="explorer_ca_fen_engi_idx")]

    def __str__(self) -> str:
        return f"{self.engine_version}:{self.fen} depth={self.depth}"


class PositionAnalysis(models.Model):
    """Versioned browser-computed MultiPV evidence for a normalized position."""

    fen = models.CharField(max_length=100)
    engine_version = models.CharField(max_length=64)
    analysis_profile = models.CharField(max_length=64)
    depth = models.PositiveSmallIntegerField()
    multi_pv = models.PositiveSmallIntegerField()
    candidates = models.JSONField(default=list)
    recurring_moves = models.JSONField(default=list)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["fen", "engine_version", "analysis_profile"],
                name="unique_position_analysis_key",
            )
        ]
        indexes = [
            models.Index(
                fields=["fen", "engine_version", "analysis_profile"],
                name="explorer_ca_analysis_key_idx",
            )
        ]

    def __str__(self) -> str:
        return f"{self.engine_version}:{self.analysis_profile}:{self.fen} depth={self.depth}"


class PositionFeatureSet(models.Model):
    """Versioned deterministic board facts derived from a normalized FEN."""

    fen = models.CharField(max_length=100)
    schema_version = models.PositiveSmallIntegerField()
    extractor_version = models.CharField(max_length=64)
    facts = models.JSONField(default=list)
    checksum = models.CharField(max_length=64)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["fen", "extractor_version"], name="unique_position_feature_set_key"
            )
        ]
        indexes = [models.Index(fields=["fen", "extractor_version"], name="explorer_ca_feature_key_idx")]

    def __str__(self) -> str:
        return f"{self.extractor_version}:{self.fen}"


class PlayerStatsCache(models.Model):
    """Short-lived terminal result from Lichess's per-user player explorer."""

    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE)
    fen = models.CharField(max_length=100)
    color = models.CharField(max_length=5)
    params_key = models.CharField(max_length=64)
    response = models.JSONField()
    fetched_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "fen", "color", "params_key"], name="unique_player_stats_cache_key"
            )
        ]
        indexes = [
            models.Index(fields=["user", "fen", "color", "params_key"], name="explorer_ca_user_id_fen_idx")
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.color}:{self.fen}:{self.params_key}"

    @property
    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at
