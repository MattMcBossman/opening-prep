"""
Ties the pure cascade logic in `repertoire/cascade.py` to the database: loads a
`Repertoire`'s edges into the same dict shape `useRepertoire.ts` operates on,
applies a mutation, and persists the result inside one transaction. Keeping
this separate from `views.py` means the cascade rules stay testable against
plain dicts (`repertoire/tests/test_cascade.py`) with no ORM involved.
"""

from django.db import transaction

from common.fen import normalize_fen

from . import cascade
from .models import Repertoire, RepertoireMove


def load_tree(repertoire: Repertoire) -> cascade.Tree:
    tree: cascade.Tree = {}
    for move in repertoire.moves.all():
        tree.setdefault(move.origin_fen, []).append(
            {"san": move.san, "uci": move.uci, "resultingFen": move.resulting_fen}
        )
    return tree


def save_tree(repertoire: Repertoire, tree: cascade.Tree) -> None:
    """
    Persists `tree` as the complete new edge set for `repertoire`. Diffed
    against the current rows (rather than a blind delete-then-recreate) so
    `RepertoireMove` primary keys of untouched edges stay stable.
    """
    existing = {(m.origin_fen, m.uci): m.id for m in repertoire.moves.all()}
    target = {(origin, edge["uci"]): edge for origin, edges in tree.items() for edge in edges}

    stale_ids = [pk for key, pk in existing.items() if key not in target]
    if stale_ids:
        RepertoireMove.objects.filter(id__in=stale_ids).delete()

    to_create = [
        RepertoireMove(
            repertoire=repertoire,
            origin_fen=origin,
            san=edge["san"],
            uci=edge["uci"],
            resulting_fen=edge["resultingFen"],
        )
        for (origin, uci), edge in target.items()
        if (origin, uci) not in existing
    ]
    if to_create:
        RepertoireMove.objects.bulk_create(to_create)


def serialize_tree(repertoire: Repertoire) -> dict[str, list[dict]]:
    """The wire shape for `GET .../tree/` - grouped exactly like `RepertoireTree`."""
    return load_tree(repertoire)


@transaction.atomic
def add_moves(repertoire: Repertoire, moves: list[dict]) -> dict:
    """
    Adds each `{originFen, san, uci, resultingFen}` edge. Mirrors the client's
    own-move save, which cascades to include every earlier ply (opponent
    replies included) in `moves` already - see
    frontend/src/hooks/useRepertoire.ts. Edges that already exist are a no-op.
    """
    tree = load_tree(repertoire)
    for move in moves:
        origin = normalize_fen(move["originFen"])
        edge = {
            "san": move["san"],
            "uci": move["uci"],
            "resultingFen": normalize_fen(move["resultingFen"]),
        }
        cascade.add_move(tree, origin, edge)
    save_tree(repertoire, tree)
    return serialize_tree(repertoire)


@transaction.atomic
def remove_move(repertoire: Repertoire, origin_fen: str, uci: str) -> dict:
    """Applies the full cascade-delete for one edge - see `cascade.remove_move`."""
    tree = load_tree(repertoire)
    cascade.remove_move(tree, repertoire.color, normalize_fen(origin_fen), uci)
    save_tree(repertoire, tree)
    return serialize_tree(repertoire)


@transaction.atomic
def import_tree(repertoire: Repertoire, tree_payload: dict[str, list[dict]]) -> dict:
    """
    One-time `localStorage` migration for one color: adds every edge in
    `tree_payload`, reporting how many were newly added vs. already present.
    No cascade-delete needed here (unlike `remove_move`) - import only ever
    adds edges, and `add_move`'s no-op-on-duplicate behaviour already gives the
    idempotency the contract asks for.
    """
    tree = load_tree(repertoire)
    imported = skipped = 0
    for origin, edges in tree_payload.items():
        normalized_origin = normalize_fen(origin)
        for edge in edges:
            added = cascade.add_move(
                tree,
                normalized_origin,
                {
                    "san": edge["san"],
                    "uci": edge["uci"],
                    "resultingFen": normalize_fen(edge["resultingFen"]),
                },
            )
            if added:
                imported += 1
            else:
                skipped += 1
    save_tree(repertoire, tree)
    return {"imported": imported, "skipped": skipped}


def get_or_create_default(user, color: str) -> Repertoire:
    """
    The lazily-created "Default" repertoire for one color - see
    API_CONTRACT.md. Identified by `(owner, color, name="Default")` rather
    than just `(owner, color)`, since `Repertoire` is a collection and a user
    may eventually have other, explicitly-named repertoires of the same color.
    """
    repertoire, _ = Repertoire.objects.get_or_create(owner=user, color=color, name="Default")
    return repertoire
