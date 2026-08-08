"""
Resolves and authorizes a client-supplied `repertoireId` against the
requesting user.

Without this check an authenticated user could attribute a drill session to
someone else's repertoire just by guessing an id, so the rule lives in one
place rather than being repeated in every endpoint that accepts a
`repertoireId`.
"""

from django.contrib.auth.models import AbstractBaseUser
from rest_framework.exceptions import ValidationError

from repertoire.models import Repertoire

# Deliberately identical for "no such repertoire" and "belongs to someone
# else": distinguishing them would let a caller probe which ids exist.
_REJECTION = "No such repertoire."


def resolve_repertoire_id(raw_repertoire_id, user: AbstractBaseUser) -> int:
    """
    Returns the id if it is a well-formed reference to a repertoire owned by
    `user`, and otherwise raises DRF's `ValidationError` (400).

    400 rather than 403/404 because this arrives as a field in a request body,
    not as a URL path segment - a bad `repertoireId` is a malformed request,
    and answering every rejection the same way keeps the endpoint from
    confirming whether a given id exists.
    """
    try:
        repertoire_id = int(raw_repertoire_id)
    except (TypeError, ValueError) as exc:
        raise ValidationError({"repertoireId": "Must be an integer."}) from exc
    if repertoire_id <= 0:
        raise ValidationError({"repertoireId": "Must be a positive integer."})

    if not Repertoire.objects.filter(id=repertoire_id, owner=user).exists():
        raise ValidationError({"repertoireId": _REJECTION})
    return repertoire_id
