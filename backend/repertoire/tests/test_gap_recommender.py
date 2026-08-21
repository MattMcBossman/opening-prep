import chess

from common.fen import normalize_fen
from repertoire.gap_recommender import (
    GapCandidate,
    candidates_from_generated_tree,
    position_distance,
    rank_gap_candidates,
)
from repertoire.opening_generator import GenerationResult, NodeReport


def fen_after(*moves: str) -> str:
    board = chess.Board()
    for move in moves:
        board.push_uci(move)
    return board.fen(en_passant="legal")


def candidate(
    id: str,
    gap: str,
    path: tuple[str, ...],
    *,
    reach: float,
    response: float,
    games: int,
    fen: str | None = None,
    loss: int | None = None,
) -> GapCandidate:
    return GapCandidate(id, gap, path, fen or fen_after(*path), reach, response, games, loss)


def test_optimizer_prefers_more_coverage_per_new_move_and_recomputes_shared_cost():
    common = ("e2e4", "e7e6", "d2d4", "d7d5")
    candidates = [
        candidate("shared-a", "a", (*common, "b1c3"), reach=0.8, response=0.5, games=50_000),
        candidate("shared-b", "b", (*common, "b1c3", "g8f6"), reach=0.6, response=0.4, games=30_000),
        candidate("expensive", "c", ("d2d4", "d7d5", "c2c4"), reach=0.7, response=0.5, games=60_000),
    ]

    proposals = rank_gap_candidates(candidates, [common], {fen_after(*common)}, move_budget=2)

    assert [proposal.candidate.id for proposal in proposals] == ["shared-a", "shared-b"]
    assert [proposal.new_move_count for proposal in proposals] == [1, 1]


def test_optimizer_combines_response_rate_with_game_volume():
    common = ("e2e4", "e7e6")
    high_rate_tiny_sample = candidate("tiny", "tiny", (*common, "d2d4"), reach=1, response=0.7, games=30)
    slightly_lower_rate_large_sample = candidate(
        "large", "large", (*common, "g1f3"), reach=1, response=0.6, games=300_000
    )

    proposals = rank_gap_candidates(
        [high_rate_tiny_sample, slightly_lower_rate_large_sample],
        [common],
        {fen_after(*common)},
        move_budget=1,
    )

    assert proposals[0].candidate.id == "large"


def test_optimizer_prefers_familiar_positions_but_rejects_unsound_moves():
    common = ("e2e4", "e7e6")
    familiar_fen = fen_after(*common, "d2d4")
    candidates = [
        candidate("familiar", "gap", (*common, "d2d4"), reach=1, response=0.5, games=10_000),
        candidate("unfamiliar", "gap", (*common, "g1f3"), reach=1, response=0.52, games=10_000),
        candidate("unsound", "other", (*common, "f2f3"), reach=1, response=0.9, games=50_000, loss=120),
    ]

    proposals = rank_gap_candidates(candidates, [common], {familiar_fen}, move_budget=2)

    assert [proposal.candidate.id for proposal in proposals] == ["familiar"]
    assert proposals[0].exact_transposition is True


def test_position_similarity_requires_the_same_side_to_move():
    white = normalize_fen(fen_after("e2e4", "e7e6"))
    black = normalize_fen(fen_after("e2e4"))

    assert position_distance(white, white) == 0
    assert position_distance(white, black) is None


def test_generated_candidate_uses_gap_reach_and_response_rate():
    board = chess.Board()
    root = normalize_fen(board.fen())
    board.push_uci("e2e4")
    after_e4 = normalize_fen(board.fen())
    result = GenerationResult(
        name="Gaps",
        color="white",
        prefix_uci=["e2e4"],
        lines=[["e2e4", "c7c5"]],
        reports=[
            NodeReport(root, 0, "white", 1000, [{"uci": "e2e4", "games": 500}], [], 0.5, "choice"),
            NodeReport(after_e4, 1, "black", 500, [{"uci": "c7c5", "games": 200}], [], 0.4, "coverage"),
        ],
        settings={},
        engine=None,
    )

    candidates = candidates_from_generated_tree(result, [("e2e4", "e7e5")])

    assert len(candidates) == 1
    assert candidates[0].gap_key == "e2e4"
    assert candidates[0].reach_rate == 0.5
    assert candidates[0].response_rate == 0.4
    assert candidates[0].marginal_coverage == 0.2
