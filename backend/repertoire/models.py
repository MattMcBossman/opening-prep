"""Repertoire trees: FEN-keyed move edges, cascade deletes, bulk import."""

from django.conf import settings
from django.db import models


class Repertoire(models.Model):
    """
    A named collection of saved moves for one color, owned by a user.

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
    color = models.CharField(max_length=5, choices=COLOR_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"{self.owner}'s {self.name} ({self.color})"


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

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["repertoire", "origin_fen", "uci"], name="unique_repertoire_edge"
            ),
        ]
        indexes = [
            models.Index(fields=["repertoire", "origin_fen"]),
        ]

    def __str__(self) -> str:
        return f"{self.origin_fen} --{self.san}--> {self.resulting_fen}"
