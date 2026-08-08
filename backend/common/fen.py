"""
FEN helpers shared by every app.

These are deliberate ports of `frontend/src/lib/chessUtils.ts`, and must stay
behaviourally identical to it: the repertoire is keyed by normalized FEN on both
sides of the wire, so a difference in normalization would silently split a
position into two distinct repertoire nodes.

Nothing here needs a chess engine or move generator - it is pure FEN field
manipulation. `python-chess` is used elsewhere only to *validate* that a FEN or
move submitted by a client is legal.
"""

from typing import Literal

Color = Literal["white", "black"]

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


def normalize_fen(fen: str) -> str:
    """
    Drop the halfmove clock and fullmove number (fields 5 and 6), keeping board,
    side to move, castling rights and en-passant target.

    Two FENs differing only in those trailing counters are the same position
    reached by a different move order - a transposition - and must map to the
    same repertoire node.
    """
    return " ".join(fen.split(" ")[:4])


def side_to_move(fen: str) -> Color:
    """Which color is to move in `fen`."""
    parts = fen.split(" ")
    return "black" if len(parts) > 1 and parts[1] == "b" else "white"


def denormalize_fen(fen: str, ply: int) -> str:
    """
    Restore the counters `normalize_fen` drops, so a stored position key can be
    handed to something that demands a complete FEN (Stockfish, the Lichess
    explorer). The move number is derived from an explicit ply count, since a
    normalized FEN has no record of it; the halfmove clock is unrecoverable and
    reported as 0, which is harmless for opening positions.
    """
    parts = fen.split(" ")
    if len(parts) >= 6:
        return fen
    halfmove = parts[4] if len(parts) > 4 else "0"
    return " ".join([*parts[:4], halfmove, str(ply // 2 + 1)])
