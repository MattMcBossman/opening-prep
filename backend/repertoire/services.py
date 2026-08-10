"""
Ties the pure cascade logic in `repertoire/cascade.py` to the database: loads a
`Repertoire`'s edges into the same dict shape `useRepertoire.ts` operates on,
applies a mutation, and persists the result inside one transaction. Keeping
this separate from `views.py` means the cascade rules stay testable against
plain dicts (`repertoire/tests/test_cascade.py`) with no ORM involved.
"""

import hashlib

from django.db import transaction

from common.fen import START_FEN, normalize_fen

from . import cascade
from .models import (
    OpeningTemplateRelease,
    ProfileModule,
    Repertoire,
    RepertoireLine,
    RepertoireLineStep,
    RepertoireMove,
    RepertoireProfile,
)
from .validation import resulting_fen_for_edge, validate_edge


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
    existing = {(m.origin_fen, m.uci): m for m in repertoire.moves.all()}
    target = {(origin, edge["uci"]): edge for origin, edges in tree.items() for edge in edges}

    stale_ids = [move.id for key, move in existing.items() if key not in target]
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

    # Persist list order explicitly. It determines the explorer continuation
    # order and PGN main line, and must not depend on the database query plan.
    to_update = []
    refreshed = {(m.origin_fen, m.uci): m for m in repertoire.moves.all()}
    for origin, edges in tree.items():
        for sort_order, edge in enumerate(edges):
            move = refreshed[(origin, edge["uci"])]
            if (
                move.sort_order != sort_order
                or move.san != edge["san"]
                or move.resulting_fen != edge["resultingFen"]
            ):
                move.sort_order = sort_order
                move.san = edge["san"]
                move.resulting_fen = edge["resultingFen"]
                to_update.append(move)
    if to_update:
        RepertoireMove.objects.bulk_update(to_update, ["sort_order", "san", "resulting_fen"])

    sync_lines_from_tree(repertoire, tree)


def _enumerate_line_paths(tree: cascade.Tree) -> list[list[tuple[str, str]]]:
    """Returns root-to-leaf paths as `(origin_fen, uci)` graph-edge keys."""

    paths: list[list[tuple[str, str]]] = []

    def walk(fen: str, steps: list[tuple[str, str]], visited: frozenset[str]) -> None:
        key = normalize_fen(fen)
        edges = tree.get(key, [])
        if not edges:
            if steps:
                paths.append(steps)
            return

        advanced = False
        for edge in edges:
            resulting_fen = normalize_fen(edge["resultingFen"])
            if resulting_fen in visited:
                continue
            advanced = True
            walk(resulting_fen, [*steps, (key, edge["uci"])], visited | {key})
        if not advanced and steps:
            paths.append(steps)

    walk(START_FEN, [], frozenset())
    return paths


def sync_lines_from_tree(repertoire: Repertoire, tree: cascade.Tree) -> None:
    """
    Compatibility bridge while the current client still submits graph edges.

    Rebuilds explicit root-to-leaf line membership from the canonical graph,
    preserving a line's UUID when its full UCI path still exists. Once the
    client submits authored lines directly, this becomes a validation/repair
    utility rather than the normal mutation path.
    """

    paths = _enumerate_line_paths(tree)
    desired = []
    for sort_order, path in enumerate(paths):
        uci_path = " ".join(uci for _, uci in path)
        desired.append(
            {
                "line_key": hashlib.sha256(uci_path.encode()).hexdigest(),
                "uci_path": uci_path,
                "sort_order": sort_order,
                "path": path,
            }
        )

    desired_keys = {item["line_key"] for item in desired}
    repertoire.lines.exclude(line_key__in=desired_keys).delete()
    move_by_key = {(m.origin_fen, m.uci): m for m in repertoire.moves.all()}

    for item in desired:
        line, _ = RepertoireLine.objects.update_or_create(
            repertoire=repertoire,
            line_key=item["line_key"],
            defaults={
                "uci_path": item["uci_path"],
                "sort_order": item["sort_order"],
            },
        )
        line.steps.all().delete()
        RepertoireLineStep.objects.bulk_create(
            RepertoireLineStep(line=line, ply=ply, move=move_by_key[edge_key])
            for ply, edge_key in enumerate(item["path"])
        )


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
    profile = get_or_create_default_profile(user)
    ProfileModule.objects.get_or_create(
        profile=profile,
        module=repertoire,
        defaults={"sort_order": 0 if color == Repertoire.WHITE else 1},
    )
    return repertoire


def get_or_create_default_profile(user) -> RepertoireProfile:
    profile, _ = RepertoireProfile.objects.get_or_create(owner=user, name="Default")
    return profile


@transaction.atomic
def add_authored_line(
    repertoire: Repertoire,
    steps: list[dict],
    label: str = "",
    source: str = "manual",
    annotations: list[dict] | None = None,
):
    """Create/reuse one explicit path while maintaining its graph-edge union."""
    normalized = []
    expected = normalize_fen(START_FEN)
    for raw in steps:
        origin = normalize_fen(raw["originFen"])
        resulting = normalize_fen(raw["resultingFen"])
        if origin != expected:
            raise ValueError("Line steps must be connected and begin at the standard initial position.")
        validate_edge(origin, raw["uci"])
        if resulting_fen_for_edge(origin, raw["uci"]) != resulting:
            raise ValueError("A step's resultingFen does not match its legal move.")
        normalized.append(
            {"originFen": origin, "san": raw["san"], "uci": raw["uci"], "resultingFen": resulting}
        )
        expected = resulting

    uci_path = " ".join(step["uci"] for step in normalized)
    existing_paths = list(repertoire.lines.values_list("uci_path", flat=True))
    exact = repertoire.lines.filter(uci_path=uci_path).first()
    if exact:
        changed = []
        if label and exact.label != label:
            exact.label = label
            changed.append("label")
        if source and exact.source != source:
            exact.source = source
            changed.append("source")
        if annotations is not None and exact.annotations != annotations:
            exact.annotations = annotations
            changed.append("annotations")
        if changed:
            exact.save(update_fields=[*changed, "updated_at"])
        return
    if any(path.startswith(f"{uci_path} ") for path in existing_paths):
        return

    tree = load_tree(repertoire)
    for step in normalized:
        cascade.add_move(
            tree,
            step["originFen"],
            {"san": step["san"], "uci": step["uci"], "resultingFen": step["resultingFen"]},
        )
    # Save graph without compatibility line regeneration.
    existing = {(m.origin_fen, m.uci): m for m in repertoire.moves.all()}
    for step in normalized:
        key = (step["originFen"], step["uci"])
        if key not in existing:
            existing[key] = RepertoireMove.objects.create(
                repertoire=repertoire,
                origin_fen=step["originFen"],
                san=step["san"],
                uci=step["uci"],
                resulting_fen=step["resultingFen"],
                sort_order=len(tree.get(step["originFen"], [])) - 1,
            )

    # Extending a terminal prefix replaces it; UUID identity belongs to full paths.
    repertoire.lines.filter(uci_path__in=[p for p in existing_paths if uci_path.startswith(f"{p} ")]).delete()
    key = hashlib.sha256(uci_path.encode()).hexdigest()
    line, _ = RepertoireLine.objects.get_or_create(
        repertoire=repertoire,
        line_key=key,
        defaults={
            "uci_path": uci_path,
            "label": label,
            "source": source,
            "annotations": annotations or [],
            "sort_order": repertoire.lines.count(),
        },
    )
    RepertoireLineStep.objects.bulk_create(
        RepertoireLineStep(line=line, ply=ply, move=existing[(step["originFen"], step["uci"])])
        for ply, step in enumerate(normalized)
    )


@transaction.atomic
def delete_authored_line(repertoire: Repertoire, line: RepertoireLine) -> None:
    line.delete()
    referenced = set(
        RepertoireLineStep.objects.filter(line__repertoire=repertoire).values_list("move_id", flat=True)
    )
    repertoire.moves.exclude(id__in=referenced).delete()


@transaction.atomic
def import_release_lines(repertoire: Repertoire, release: OpeningTemplateRelease) -> None:
    """Import a release graph while retaining its authored path metadata."""
    import_tree(repertoire, release.tree)
    repertoire.lines.all().delete()
    for payload in sorted(release.lines, key=lambda line: line.get("sortOrder", 0)):
        add_authored_line(
            repertoire,
            payload["steps"],
            label=payload.get("label", ""),
            source=payload.get("source", RepertoireLine.SOURCE_MANUAL),
            annotations=payload.get("annotations", []),
        )
        uci_path = " ".join(step["uci"] for step in payload["steps"])
        repertoire.lines.filter(uci_path=uci_path).update(sort_order=payload.get("sortOrder", 0))


@transaction.atomic
def import_missing_release_lines(repertoire: Repertoire, release: OpeningTemplateRelease) -> dict:
    """Add only release paths not already covered by a personal authored path."""
    existing_paths = list(repertoire.lines.values_list("uci_path", flat=True))
    added = 0
    skipped = 0
    for payload in sorted(release.lines, key=lambda line: line.get("sortOrder", 0)):
        uci_path = " ".join(step["uci"] for step in payload["steps"])
        if any(path == uci_path or path.startswith(f"{uci_path} ") for path in existing_paths):
            skipped += 1
            continue
        add_authored_line(
            repertoire,
            payload["steps"],
            label=payload.get("label", ""),
            source=payload.get("source", RepertoireLine.SOURCE_MANUAL),
            annotations=payload.get("annotations", []),
        )
        if repertoire.lines.filter(uci_path=uci_path).exists():
            added += 1
            existing_paths.append(uci_path)
        else:
            skipped += 1
    return {"added": added, "skipped": skipped}
