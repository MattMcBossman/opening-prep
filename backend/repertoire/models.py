"""Repertoire trees: FEN-keyed move edges, cascade deletes, bulk import."""

import uuid

from django.conf import settings
from django.db import models


class RepertoireProfile(models.Model):
    """A named, user-owned composition of reusable opening modules."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="repertoire_profiles"
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["owner", "name"], name="unique_profile_name_per_owner")
        ]

    def __str__(self) -> str:
        return f"{self.owner}'s {self.name} profile"


class Repertoire(models.Model):
    """
    A reusable, user-owned opening module for one color.

    Modeled as a collection - not a hardcoded white/black pair - from day one:
    AGENTS.md defers "multiple repertoire profiles with overlays" until backend
    persistence exists, and this schema is meant to unblock that without a
    future migration. In the meantime exactly one "Default" repertoire per
    color is created lazily per user (see repertoire/views.py).
    """

    WHITE = "white"
    BLACK = "black"
    COLOR_CHOICES = [(WHITE, "White"), (BLACK, "Black")]

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="repertoires")
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    source_release = models.ForeignKey(
        "OpeningTemplateRelease",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="copies",
    )
    color = models.CharField(max_length=5, choices=COLOR_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"{self.owner}'s {self.name} ({self.color})"


class ProfileModule(models.Model):
    """One personal opening module enabled in a composed repertoire profile."""

    profile = models.ForeignKey(RepertoireProfile, on_delete=models.CASCADE, related_name="module_links")
    module = models.ForeignKey(Repertoire, on_delete=models.CASCADE, related_name="profile_links")
    sort_order = models.PositiveIntegerField(default=0)
    enabled = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["profile", "module"], name="unique_module_per_profile")
        ]

    def __str__(self) -> str:
        return f"{self.profile} -> {self.module}"


class OpeningTemplate(models.Model):
    """An official or community-published opening with immutable releases."""

    OFFICIAL = "official"
    COMMUNITY = "community"
    KIND_CHOICES = [(OFFICIAL, "Official"), (COMMUNITY, "Community")]

    slug = models.SlugField(max_length=100, unique=True)
    kind = models.CharField(max_length=12, choices=KIND_CHOICES, default=OFFICIAL)
    publisher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="published_opening_templates",
    )
    source_module = models.OneToOneField(
        "Repertoire", null=True, blank=True, on_delete=models.SET_NULL, related_name="published_template"
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    color = models.CharField(max_length=5, choices=Repertoire.COLOR_CHOICES)
    is_published = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name", "id"]

    def __str__(self) -> str:
        return self.name


class OpeningTemplateRelease(models.Model):
    """An immutable snapshot of a global module's graph and authored lines."""

    template = models.ForeignKey(OpeningTemplate, on_delete=models.CASCADE, related_name="releases")
    version = models.PositiveIntegerField()
    changelog = models.TextField(blank=True)
    tree = models.JSONField(default=dict)
    lines = models.JSONField(default=list)
    common_start = models.CharField(max_length=500, blank=True)
    line_count = models.PositiveIntegerField(default=0)
    published_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-version"]
        constraints = [
            models.UniqueConstraint(fields=["template", "version"], name="unique_template_version")
        ]

    def __str__(self) -> str:
        return f"{self.template} v{self.version}"

    def save(self, *args, **kwargs):
        if self.pk and OpeningTemplateRelease.objects.filter(pk=self.pk).exists():
            raise ValueError("Published opening-template releases are immutable.")
        from .release_metadata import release_summary

        self.common_start, self.line_count = release_summary(self.lines, self.template.color)
        self.full_clean()
        return super().save(*args, **kwargs)

    def clean(self):
        super().clean()
        from .validation import validate_release_snapshot

        validate_release_snapshot(self.tree, self.lines, self.template.color)


class ProfileTemplateRelease(models.Model):
    profile = models.ForeignKey(RepertoireProfile, on_delete=models.CASCADE, related_name="template_links")
    release = models.ForeignKey(
        OpeningTemplateRelease, on_delete=models.PROTECT, related_name="profile_links"
    )
    sort_order = models.PositiveIntegerField(default=0)
    enabled = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["profile", "release"], name="unique_release_per_profile")
        ]

    def __str__(self) -> str:
        return f"{self.profile} -> {self.release}"


class RepertoireMove(models.Model):
    """
    One edge in a repertoire's move graph: `origin_fen` -[san/uci]-> `resulting_fen`,
    both normalized (see common/fen.py). An edge list, not a parent-pointer
    tree, so a position reached by different move orders (a transposition) is
    naturally a single node with multiple incoming edges - exactly the shape
    `repertoire/cascade.py`'s reachability checks depend on. Hard-deleted, not
    soft-deleted: the cascade rules already have precise reachability logic, and
    a soft-delete flag would complicate them for no current benefit.

    Maps 1:1 onto the frontend's `RepertoireTree` (`Record<fen, RepertoireMove[]>`),
    so `GET .../tree/` can hand back this table grouped by `origin_fen` with no
    reshaping beyond that grouping.
    """

    repertoire = models.ForeignKey(Repertoire, on_delete=models.CASCADE, related_name="moves")
    origin_fen = models.CharField(max_length=100)
    san = models.CharField(max_length=16)
    uci = models.CharField(max_length=8)
    resulting_fen = models.CharField(max_length=100)
    # Makes explorer ordering and PGN main-line selection deterministic instead
    # of relying on incidental database row order.
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["repertoire", "origin_fen", "uci"], name="unique_repertoire_edge"
            ),
        ]
        indexes = [
            models.Index(fields=["repertoire", "origin_fen"]),
        ]
        ordering = ["origin_fen", "sort_order", "id"]

    def __str__(self) -> str:
        return f"{self.origin_fen} --{self.san}--> {self.resulting_fen}"


class RepertoireLine(models.Model):
    """A stable, explicit root-to-leaf move order through a module's FEN graph."""

    SOURCE_MANUAL = "manual"
    SOURCE_PGN_IMPORT = "pgn_import"
    SOURCE_MIGRATED = "migrated"
    SOURCE_CHOICES = [
        (SOURCE_MANUAL, "Manual"),
        (SOURCE_PGN_IMPORT, "PGN import"),
        (SOURCE_MIGRATED, "Migrated graph"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    repertoire = models.ForeignKey(Repertoire, on_delete=models.CASCADE, related_name="lines")
    # SHA-256 of the full UCI sequence: compact, deterministic identity for
    # preserving a line UUID when unrelated graph branches change.
    line_key = models.CharField(max_length=64)
    uci_path = models.TextField()
    label = models.CharField(max_length=150, blank=True)
    annotations = models.JSONField(default=list, blank=True)
    source = models.CharField(max_length=16, choices=SOURCE_CHOICES, default=SOURCE_MANUAL)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["repertoire", "line_key"], name="unique_line_per_module")
        ]

    def __str__(self) -> str:
        return f"{self.repertoire}: {self.uci_path}"


class RepertoireLineStep(models.Model):
    """One ordered occurrence of a graph edge in an explicit authored line."""

    line = models.ForeignKey(RepertoireLine, on_delete=models.CASCADE, related_name="steps")
    ply = models.PositiveIntegerField()
    move = models.ForeignKey(RepertoireMove, on_delete=models.CASCADE, related_name="line_steps")

    class Meta:
        ordering = ["ply"]
        constraints = [models.UniqueConstraint(fields=["line", "ply"], name="unique_ply_per_line")]

    def __str__(self) -> str:
        return f"{self.line_id} ply {self.ply}: {self.move.uci}"
