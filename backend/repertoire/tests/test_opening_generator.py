import io
import json

import chess
import chess.pgn
import pytest

from repertoire.opening_generator import (
    ExplorerMove,
    ExplorerPosition,
    GenerationError,
    GeneratorConfig,
    generate_candidate,
)


class FakeSource:
    def __init__(self, positions):
        self.positions = positions

    def lookup(self, board):
        fen = " ".join(board.fen(en_passant="legal").split()[:4])
        return self.positions.get(fen, ExplorerPosition(0, ()))


class FakeEvaluator:
    name = "fakefish-depth-12"

    def __init__(self, scores):
        self._scores = scores

    def scores(self, board, moves):
        return {move.uci(): self._scores[move.uci()] for move in moves}

    def close(self):
        pass


def after(*uci_moves):
    board = chess.Board()
    for uci in uci_moves:
        board.push_uci(uci)
    return " ".join(board.fen(en_passant="legal").split()[:4])


def test_generator_branches_and_chooses_popular_engine_sound_move():
    prefix = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5"]
    uci = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "f3g5"]
    source = FakeSource(
        {
            after(*uci): ExplorerPosition(
                1000,
                (
                    ExplorerMove("d7d5", "d5", 700),
                    ExplorerMove("f6e4", "Nxe4", 200),
                    ExplorerMove("d8e7", "Qe7", 50),
                ),
            ),
            after(*uci, "d7d5"): ExplorerPosition(
                700,
                (
                    ExplorerMove("e4d5", "exd5", 500),
                    ExplorerMove("g5f7", "Nxf7", 180),
                ),
            ),
            after(*uci, "f6e4"): ExplorerPosition(200, (ExplorerMove("c4f7", "Bxf7+", 150),)),
        }
    )
    evaluator = FakeEvaluator({"e4d5": 30, "g5f7": 55, "c4f7": 10})
    config = GeneratorConfig(
        name="Fried Liver Attack",
        color="white",
        coverage=0.85,
        max_lines=2,
        max_ply=9,
        min_games=10,
        min_frequency=0.01,
        max_engine_loss_cp=30,
    )

    result = generate_candidate(prefix, config, source, evaluator)

    assert result.lines == [[*uci, "d7d5", "e4d5"], [*uci, "f6e4", "c4f7"]]
    assert result.reports[0].covered_fraction == 0.9
    assert result.reports[1].reason == "popular_engine_sound_choice"
    assert json.loads(result.report_json())["leafCount"] == 2
    game = chess.pgn.read_game(io.StringIO(result.pgn()))
    branch = game
    for _ in range(7):
        branch = branch.variations[0]
    assert {variation.move.uci() for variation in branch.variations} == {"d7d5", "f6e4"}


def test_generator_respects_small_leaf_budget_and_reports_omissions():
    source = FakeSource(
        {
            after("e2e4"): ExplorerPosition(
                100,
                (
                    ExplorerMove("c7c5", "c5", 50),
                    ExplorerMove("e7e5", "e5", 30),
                    ExplorerMove("e7e6", "e6", 20),
                ),
            )
        }
    )
    config = GeneratorConfig(
        name="Focused e4 module",
        color="white",
        coverage=1,
        max_lines=2,
        max_ply=4,
        min_games=1,
        min_frequency=0,
    )

    result = generate_candidate(["e4"], config, source)

    assert len(result.lines) == 2
    assert [move["uci"] for move in result.reports[0].omitted] == ["e7e6"]


def test_generator_rejects_bad_prefix_and_prefix_at_depth_limit():
    config = GeneratorConfig(name="Bad", color="white", max_ply=1)
    with pytest.raises(GenerationError, match="Illegal or invalid"):
        generate_candidate(["e5"], config, FakeSource({}))
    with pytest.raises(GenerationError, match="before max_ply"):
        generate_candidate(["e4"], config, FakeSource({}))
