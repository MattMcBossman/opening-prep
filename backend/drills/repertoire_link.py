"""
Resolves and authorizes a client-supplied `repertoireId` against the
requesting user.

`repertoire.models.Repertoire` is owned by the accounts/repertoire agent,
built in parallel on a different branch, and doesn't exist here yet (see
`DrillSession.repertoire_id` in `drills/models.py`). Without *some* ownership
check here, an authenticated user could attribute a drill session to another
user's repertoire id just by guessing a number, so this module exists to hold
that check in exactly one place - the lead fills in the real lookup once both
apps are on the same branch, rather than a check having to be retrofitted into
every endpoint that accepts a `repertoireId`.
"""

from django.contrib.auth.models import AbstractBaseUser
from rest_framework.exceptions import PermissionDenied, ValidationError


def resolve_repertoire_id(raw_repertoire_id, user: AbstractBaseUser) -> int:
    """
    Validates `raw_repertoire_id` and, once `repertoire.models.Repertoire`
    exists, will also confirm it's owned by `user`. Raises DRF's
    `ValidationError` (400) for a malformed id and `PermissionDenied` (403)
    for one that exists but belongs to someone else.

    Interim behaviour (no `repertoire` app models yet): only shape-validates
    that it's a positive integer. This is intentionally not a full ownership
    check - it can't be, without the other app's model - so it should not be
    read as "this is already secure"; the real check lands in the same
    `try`/`except ImportError` shape as `explorer_cache/lichess_token.py` and
    the lead fills in `_owned_repertoire_id` at merge time.
    """
    try:
        repertoire_id = int(raw_repertoire_id)
    except (TypeError, ValueError) as exc:
        raise ValidationError({"repertoireId": "Must be an integer."}) from exc
    if repertoire_id <= 0:
        raise ValidationError({"repertoireId": "Must be a positive integer."})

    owned_id = _owned_repertoire_id(repertoire_id, user)
    if owned_id is None:
        # repertoire.models.Repertoire isn't available yet - fall back to the
        # shape check above only. See the module docstring.
        return repertoire_id
    if owned_id is False:
        raise PermissionDenied("That repertoire does not belong to you.")
    return owned_id


def _owned_repertoire_id(repertoire_id: int, user: AbstractBaseUser):
    """
    Returns the repertoire id if `user` owns it, `False` if it exists but
    belongs to someone else (or doesn't exist at all), or `None` if the
    `repertoire` app's model isn't present yet to check against.
    """
    try:
        from repertoire.models import Repertoire
    except ImportError:
        return None

    return repertoire_id if Repertoire.objects.filter(id=repertoire_id, owner=user).exists() else False
