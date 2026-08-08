"""
Direct port of the cascade rules in `frontend/src/hooks/useRepertoire.ts`
(lines 18-56). This must stay behaviourally identical to that file - it is
called out in `backend/API_CONTRACT.md` as the single most important thing to
get right in this phase, and any divergence from the TS implementation is a
defect, not a design choice.

Operates on a plain dict shaped exactly like the frontend's `RepertoireTree`
(normalized origin FEN -> list of edge dicts with `san`/`uci`/`resultingFen`),
so it can be unit-tested with no database at all - `repertoire/services.py`
loads/saves this shape from/to `RepertoireMove` rows.
"""

from common.fen import normalize_fen, side_to_move

# An edge dict: {"san": str, "uci": str, "resultingFen": str}. A `Tree` is a
# dict from normalized origin FEN to a list of edges from that position -
# `moves` in `frontend/src/types.ts`'s `RepertoireTree`.
Edge = dict
Tree = dict[str, list[Edge]]


def delete_orphaned_subtree(tree: Tree, fen: str) -> None:
    """
    Mirrors `deleteOrphanedSubtree`. After removing an edge, its child position
    (`fen`) may have been the only way to reach that position and everything
    beneath it. Delete that subtree - unless `fen` is still reachable through
    some other surviving edge (a transposition into the same position via a
    different line), in which case it, and everything beneath it, stays.
    Mutates `tree` in place.
    """
    # Defensive, like the TS original: resultingFen is documented as always
    # normalized already, but a lookup here must not silently no-op if that
    # invariant is ever violated upstream.
    key = normalize_fen(fen)
    still_reachable = any(edge["resultingFen"] == key for edges in tree.values() for edge in edges)
    if still_reachable:
        return

    children = tree.pop(key, None)
    if not children:
        return
    for child in children:
        delete_orphaned_subtree(tree, child["resultingFen"])


def prune_responseless_incoming_edges(tree: Tree, color: str, origin_fen: str) -> None:
    """
    Mirrors `pruneResponselessIncomingEdges`. After removing an edge, its
    origin position may now have zero moves saved from it. If that origin is a
    position where it's the repertoire owner's own turn, any "opponent reply"
    edge elsewhere in the tree that leads here no longer has a prepped
    response, so it's no longer useful - remove those too. The reverse case
    (the owner's own move having no opponent reply prepped yet) is a normal,
    valid state and is deliberately NOT pruned this way - see AGENTS.md.
    Mutates `tree` in place.
    """
    key = normalize_fen(origin_fen)
    if tree.get(key):
        return  # still has saved moves, not actually childless
    if side_to_move(key) != color:
        return  # a childless opponent-reply-to-be node is normal, not pruned

    for origin in list(tree.keys()):
        edges = tree[origin]
        remaining = [edge for edge in edges if edge["resultingFen"] != key]
        if len(remaining) == len(edges):
            continue
        if remaining:
            tree[origin] = remaining
        else:
            del tree[origin]


def add_move(tree: Tree, fen: str, move: Edge) -> bool:
    """
    Mirrors `addMove`. Adding an edge that's already saved is a no-op, not an
    error - see API_CONTRACT.md, this is what lets the client safely replay a
    cascade save. Returns whether an edge was actually added, so callers (the
    import endpoint) can report imported/skipped counts. Mutates `tree`.
    """
    key = normalize_fen(fen)
    existing = tree.setdefault(key, [])
    if any(edge["uci"] == move["uci"] for edge in existing):
        return False
    existing.append(move)
    return True


def remove_move(tree: Tree, color: str, fen: str, uci: str) -> None:
    """
    Mirrors `removeMove`: removes one edge (a no-op if it doesn't exist), then
    cascades via `delete_orphaned_subtree` and
    `prune_responseless_incoming_edges`, in that order - matching the TS
    original exactly. Mutates `tree` in place.
    """
    key = normalize_fen(fen)
    existing = tree.get(key)
    if not existing:
        return
    removed = next((edge for edge in existing if edge["uci"] == uci), None)
    remaining = [edge for edge in existing if edge["uci"] != uci]
    if remaining:
        tree[key] = remaining
    else:
        tree.pop(key, None)
    if removed:
        delete_orphaned_subtree(tree, removed["resultingFen"])
    prune_responseless_incoming_edges(tree, color, key)
