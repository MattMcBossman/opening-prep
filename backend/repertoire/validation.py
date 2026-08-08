"""
FEN/move legality validation for submitted repertoire edges.

`common/fen.py` normalization is enough for position *identity*, but
confirming a submitted move is actually legal needs a real move generator -
this is the one place this app reaches for `python-chess` (see the "Tree-
mutation authority" note in the phase 4 plan).
"""

import chess
from rest_framework import serializers


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
