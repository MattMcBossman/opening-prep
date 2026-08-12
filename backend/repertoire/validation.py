"""
FEN/move legality validation for submitted repertoire edges.

`common/fen.py` normalization is enough for position *identity*, but
confirming a submitted move is actually legal needs a real move generator -
this is the one place this app reaches for `python-chess` (see the "Tree-
mutation authority" note in the phase 4 plan).
"""

import chess
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from common.fen import START_FEN, normalize_fen


def validate_edge(origin_fen: str, uci: str) -> None:
    """
    Raises a DRF `ValidationError` if `origin_fen` doesn't parse or `uci` isn't
    a legal move from it. `san`/`resultingFen` are trusted from the client
    (chess.js is the source of truth for those display fields there) and are
    not independently recomputed here.
    """
    try:
        board = chess.Board(_expand_for_chess(origin_fen))
    except ValueError as exc:
        raise serializers.ValidationError({"originFen": f"Invalid FEN: {exc}"}) from exc
    try:
        move = chess.Move.from_uci(uci)
    except ValueError as exc:
        raise serializers.ValidationError({"uci": f"Invalid UCI move: {exc}"}) from exc
    if move not in board.legal_moves:
        raise serializers.ValidationError({"uci": f"Illegal move '{uci}' in position '{origin_fen}'"})


def resulting_fen_for_edge(origin_fen: str, uci: str) -> str:
    """Return the normalized position produced by a validated edge."""
    board = chess.Board(_expand_for_chess(origin_fen))
    move = chess.Move.from_uci(uci)
    board.push(move)
    # chess.js includes an en-passant target only when a legal capture exists;
    # python-chess's default `legal` mode matches that wire representation.
    return " ".join(board.fen(en_passant="legal").split(" ")[:4])


def _expand_for_chess(fen: str) -> str:
    """
    `python-chess` requires all 6 FEN fields; repertoire FENs are normalized
    (4 fields - see common/fen.py) so pad with placeholder halfmove-clock/
    fullmove-number values. Neither affects legal-move generation, only
    draw-claim bookkeeping this validation doesn't need.
    """
    parts = fen.split(" ")
    if len(parts) >= 6:
        return fen
    return " ".join([*parts[:4], "0", "1"])


def validate_release_snapshot(tree, lines, color=None) -> None:
    """Validate an immutable global release before it can be published."""
    if not isinstance(tree, dict) or not isinstance(lines, list):
        raise DjangoValidationError("Release tree must be an object and lines must be an array.")
    if tree and not lines:
        raise DjangoValidationError("A non-empty release tree must include authored lines.")

    edge_keys = set()
    for origin, edges in tree.items():
        if not isinstance(origin, str) or not isinstance(edges, list):
            raise DjangoValidationError("Every tree position must map to an array of moves.")
        normalized_origin = normalize_fen(origin)
        if color and normalized_origin.split()[1] == ("w" if color == "white" else "b") and len(edges) > 1:
            raise DjangoValidationError(
                "A release module may contain only one repertoire response per position."
            )
        for edge in edges:
            if not isinstance(edge, dict) or not all(
                isinstance(edge.get(field), str) for field in ("san", "uci", "resultingFen")
            ):
                raise DjangoValidationError(
                    "Every tree move requires string san, uci, and resultingFen fields."
                )
            try:
                validate_edge(normalized_origin, edge["uci"])
            except serializers.ValidationError as exc:
                raise DjangoValidationError(str(exc.detail)) from exc
            resulting = normalize_fen(edge["resultingFen"])
            if resulting_fen_for_edge(normalized_origin, edge["uci"]) != resulting:
                raise DjangoValidationError("A release move's resultingFen does not match its legal move.")
            key = (normalized_origin, edge["uci"])
            if key in edge_keys:
                raise DjangoValidationError(
                    "A release tree cannot contain duplicate moves from one position."
                )
            edge_keys.add(key)

    line_ids = set()
    for line in lines:
        if not isinstance(line, dict) or not isinstance(line.get("id"), str) or not line["id"]:
            raise DjangoValidationError("Every release line requires a non-empty string id.")
        if line["id"] in line_ids:
            raise DjangoValidationError("Release line ids must be unique.")
        line_ids.add(line["id"])
        steps = line.get("steps")
        if not isinstance(steps, list) or not steps:
            raise DjangoValidationError("Every release line must contain at least one step.")
        expected = normalize_fen(START_FEN)
        for step in steps:
            if not isinstance(step, dict) or not all(
                isinstance(step.get(field), str) for field in ("originFen", "san", "uci", "resultingFen")
            ):
                raise DjangoValidationError("Every line step requires originFen, san, uci, and resultingFen.")
            origin = normalize_fen(step["originFen"])
            resulting = normalize_fen(step["resultingFen"])
            if origin != expected:
                raise DjangoValidationError(
                    "Release lines must be connected and begin at the initial position."
                )
            if (origin, step["uci"]) not in edge_keys:
                raise DjangoValidationError(
                    "Every release line step must reference an edge in the release tree."
                )
            expected = resulting
