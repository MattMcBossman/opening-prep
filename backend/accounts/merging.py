"""Safe reconciliation of legacy Lichess-owned users with signed-in accounts."""

from django.db import transaction

from drills.models import DrillSession
from explorer_cache.models import PlayerStatsCache
from repertoire.models import OpeningTemplate, Repertoire, RepertoireProfile

from .models import ChessComAccount, EmailIdentity, GoogleAccount, LichessAccount, User


def _available_profile_name(owner: User, name: str) -> str:
    if not RepertoireProfile.objects.filter(owner=owner, name=name).exists():
        return name
    base = f"{name} (merged)"
    candidate = base
    suffix = 2
    while RepertoireProfile.objects.filter(owner=owner, name=candidate).exists():
        candidate = f"{base} {suffix}"
        suffix += 1
    return candidate


def _available_module_name(owner: User, name: str) -> str:
    if not Repertoire.objects.filter(owner=owner, name=name).exists():
        return name
    base = f"{name} (merged)"
    candidate = base
    suffix = 2
    while Repertoire.objects.filter(owner=owner, name=candidate).exists():
        candidate = f"{base} {suffix}"
        suffix += 1
    return candidate


def can_merge_legacy_lichess_user(user: User) -> bool:
    """Only users with no Mainline sign-in identity are safe to absorb."""
    return not (
        EmailIdentity.objects.filter(user=user).exists()
        or GoogleAccount.objects.filter(user=user).exists()
    )


@transaction.atomic
def merge_legacy_lichess_user(*, legacy_user: User, target_user: User) -> LichessAccount:
    """Move an orphaned legacy user's durable data to the active user."""
    legacy_user = User.objects.select_for_update().get(pk=legacy_user.pk)
    target_user = User.objects.select_for_update().get(pk=target_user.pk)
    if legacy_user.pk == target_user.pk or not can_merge_legacy_lichess_user(legacy_user):
        raise ValueError("The Lichess owner is not a mergeable legacy account.")

    lichess_account = LichessAccount.objects.select_for_update().get(user=legacy_user)
    if LichessAccount.objects.filter(user=target_user).exclude(pk=lichess_account.pk).exists():
        raise ValueError("The target user already has a different Lichess identity.")

    for profile in RepertoireProfile.objects.select_for_update().filter(owner=legacy_user):
        profile.name = _available_profile_name(target_user, profile.name)
        profile.owner = target_user
        profile.save(update_fields=["name", "owner", "updated_at"])

    for module in Repertoire.objects.select_for_update().filter(owner=legacy_user):
        module.name = _available_module_name(target_user, module.name)
        module.owner = target_user
        module.save(update_fields=["name", "owner", "updated_at"])
    DrillSession.objects.filter(user=legacy_user).update(user=target_user)
    OpeningTemplate.objects.filter(publisher=legacy_user).update(publisher=target_user)

    # These rows are short-lived derived data and can collide on their compound
    # uniqueness key after a merge. Let the target account refill them normally.
    PlayerStatsCache.objects.filter(user=legacy_user).delete()

    legacy_chess = ChessComAccount.objects.select_for_update().filter(user=legacy_user).first()
    if legacy_chess:
        if ChessComAccount.objects.filter(user=target_user).exists():
            legacy_chess.delete()
        else:
            legacy_chess.user = target_user
            legacy_chess.save(update_fields=["user", "updated_at"])

    lichess_account.user = target_user
    lichess_account.save(update_fields=["user", "updated_at"])
    legacy_user.delete()
    return lichess_account
