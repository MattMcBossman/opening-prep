"""
Mirrors the `normalizeFen`/`sideToMove`/`denormalizeFen` cases in
`frontend/src/lib/chessUtils.test.ts`. These functions define repertoire node
identity on both sides of the wire, so divergence between the two
implementations would silently split transpositions into separate nodes.
"""

from common.fen import START_FEN, denormalize_fen, normalize_fen, side_to_move


def test_normalize_drops_move_counters():
    assert normalize_fen(START_FEN) == "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"


def test_normalize_is_idempotent():
    once = normalize_fen(START_FEN)
    assert normalize_fen(once) == once


def test_transpositions_normalize_to_the_same_key():
    """The same position reached at different move numbers is one node."""
    via_one_order = "rnbqkb1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 4 3"
    via_another = "rnbqkb1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 12 7"
    assert normalize_fen(via_one_order) == normalize_fen(via_another)


def test_normalize_keeps_castling_and_en_passant():
    fen = "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2"
    assert normalize_fen(fen) == "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6"


def test_side_to_move():
    assert side_to_move(START_FEN) == "white"
    assert side_to_move("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3") == "black"


def test_denormalize_restores_counters_from_ply():
    normalized = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
    # ply 0 is White's first move, so the fullmove number is 1.
    assert denormalize_fen(normalized, 0).endswith(" 0 1")
    # ply 4 is White's third move.
    assert denormalize_fen(normalized, 4).endswith(" 0 3")


def test_denormalize_leaves_complete_fens_alone():
    assert denormalize_fen(START_FEN, 99) == START_FEN
