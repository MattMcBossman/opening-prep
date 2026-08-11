from django.db import IntegrityError, transaction

from common.fen import normalize_fen

from .metrics import cache_event
from .models import PositionAnalysis


def quality(candidates: list[dict]) -> tuple[int, int, int]:
    return (
        min(candidate["depth"] for candidate in candidates),
        len(candidates),
        sum(len(candidate["pvUci"]) for candidate in candidates),
    )


def get_position_analysis(fen: str, engine_version: str, analysis_profile: str) -> PositionAnalysis | None:
    row = PositionAnalysis.objects.filter(
        fen=normalize_fen(fen), engine_version=engine_version, analysis_profile=analysis_profile
    ).first()
    cache_event("position_analysis", "hit" if row else "miss", analysis_profile=analysis_profile)
    return row


def _replace(row: PositionAnalysis, candidates: list[dict], recurring_moves: list[dict]) -> None:
    row.candidates = candidates
    row.recurring_moves = recurring_moves
    row.depth = min(candidate["depth"] for candidate in candidates)
    row.multi_pv = len(candidates)
    row.save()


def upsert_position_analysis(
    *, fen: str, engine_version: str, analysis_profile: str, candidates: list[dict], recurring_moves: list[dict]
) -> tuple[PositionAnalysis, bool]:
    normalized = normalize_fen(fen)
    lookup = {"fen": normalized, "engine_version": engine_version, "analysis_profile": analysis_profile}
    with transaction.atomic():
        existing = PositionAnalysis.objects.select_for_update().filter(**lookup).first()
        if existing:
            if quality(existing.candidates) >= quality(candidates):
                if existing.recurring_moves != recurring_moves and quality(existing.candidates) == quality(candidates):
                    existing.recurring_moves = recurring_moves
                    existing.save(update_fields=["recurring_moves", "updated_at"])
                return existing, False
            _replace(existing, candidates, recurring_moves)
            return existing, True
        try:
            with transaction.atomic():
                created = PositionAnalysis.objects.create(
                    **lookup,
                    depth=min(candidate["depth"] for candidate in candidates),
                    multi_pv=len(candidates),
                    candidates=candidates,
                    recurring_moves=recurring_moves,
                )
            return created, True
        except IntegrityError:
            existing = PositionAnalysis.objects.select_for_update().get(**lookup)
            if quality(existing.candidates) >= quality(candidates):
                return existing, False
            _replace(existing, candidates, recurring_moves)
            return existing, True
