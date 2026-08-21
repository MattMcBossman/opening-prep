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
    RepertoirePositionSource,
    _select_repertoire_move,
    generate_candidate,
)


class FakeSource:
    def __init__(self, positions):
        self.positions = positions
        self.lookups = []

    def lookup(self, board):
        fen = " ".join(board.fen(en_passant="legal").split()[:4])
        self.lookups.append(fen)
        return self.positions.get(fen, ExplorerPosition(0, ()))


class FakeEvaluator:
    name = "fakefish-depth-12"

    def __init__(self, scores):
        self._scores = scores

    def scores(self, board, moves):
        return {move.uci(): self._scores[move.uci()] for move in moves}

    def close(self):
        pass


def test_repertoire_source_uses_elite_games_only_for_our_turn():
    elite_position = ExplorerPosition(10, (ExplorerMove("d2d4", "d4", 10),))
    population_position = ExplorerPosition(100, (ExplorerMove("e2e4", "e4", 70),))
    elite = FakeSource({" ".join(chess.Board().fen().split()[:4]): elite_position})
    population = FakeSource({" ".join(chess.Board().fen().split()[:4]): population_position})
    source = RepertoirePositionSource("white", elite, population)

    assert source.lookup(chess.Board()) == elite_position
    black_to_move = chess.Board()
    black_to_move.push_uci("e2e4")
    assert source.lookup(black_to_move).total_games == 0
    assert len(elite.lookups) == 1
    assert len(population.lookups) == 1


def test_repertoire_source_falls_back_when_elite_bucket_has_no_moves():
    root = " ".join(chess.Board().fen().split()[:4])
    population_position = ExplorerPosition(100, (ExplorerMove("e2e4", "e4", 70),))
    source = RepertoirePositionSource(
        "white",
        FakeSource({root: ExplorerPosition(0, ())}),
        FakeSource({root: population_position}),
    )

    assert source.lookup(chess.Board()) == population_position


def test_player_choice_can_trade_popularity_for_a_smaller_reply_tree():
    board = chess.Board()
    e4 = chess.Move.from_uci("e2e4")
    d4 = chess.Move.from_uci("d2d4")
    candidates = [
        (ExplorerMove("e2e4", "e4", 600), e4),
        (ExplorerMove("d2d4", "d4", 400), d4),
    ]
    population = FakeSource({
        " ".join(board.fen().split()[:4]): ExplorerPosition(1000, (
            ExplorerMove("e2e4", "e4", 800),
            ExplorerMove("d2d4", "d4", 200),
        )),
        after("e2e4"): ExplorerPosition(1000, (
            ExplorerMove("e7e5", "e5", 400),
            ExplorerMove("c7c5", "c5", 300),
            ExplorerMove("e7e6", "e6", 250),
        )),
        after("d2d4"): ExplorerPosition(1000, (ExplorerMove("d7d5", "d5", 950),)),
    })
    source = RepertoirePositionSource("white", FakeSource({}), population)

    selected, _ = _select_repertoire_move(board, candidates, source, 0.85, {})

    assert selected.uci == "d2d4"


def after(*uci_moves):
    board = chess.Board()
    for uci in uci_moves:
        board.push_uci(uci)
    return " ".join(board.fen(en_passant="legal").split()[:4])


def test_generator_branches_and_prefers_stronger_engine_move_within_sound_limit():
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

    progress = []
    result = generate_candidate(
        prefix,
        config,
        source,
        evaluator,
        on_progress=lambda analyzed, queued, path: progress.append((analyzed, queued, path)),
    )

    assert result.lines == [[*uci, "d7d5", "g5f7"], [*uci, "f6e4", "c4f7"]]
    assert progress[0] == (1, 1, uci)
    assert any(path == [*uci, "d7d5"] for _, _, path in progress)
    assert result.reports[0].covered_fraction == 0.9
    assert result.reports[0].reason == "coverage_target_met"
    assert result.reports[1].reason == "balanced_engine_surprise_coverage_choice"
    report = json.loads(result.report_json())
    assert report["leafCount"] == 2
    assert report["summary"] == {
        "positionsAnalyzed": 3,
        "opponentPositions": 1,
        "coverageTargetMet": 1,
        "leafBudgetLimited": 0,
        "replyLimitReached": 0,
        "frequencyThresholdLimited": 0,
        "noEligibleMoves": 0,
        "minimumOpponentCoverage": 0.9,
        "averageOpponentCoverage": 0.9,
        "maximumGeneratedPly": 9,
    }
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
            ),
            after("e2e4", "c7c5"): ExplorerPosition(
                50, (ExplorerMove("g1f3", "Nf3", 40),)
            ),
            after("e2e4", "e7e5"): ExplorerPosition(
                30, (ExplorerMove("g1f3", "Nf3", 25),)
            ),
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
    assert result.reports[0].reason == "leaf_budget_limited"
    assert [move["uci"] for move in result.reports[0].omitted] == ["e7e6"]


def test_generator_extends_one_ply_past_limit_to_finish_on_white_repertoire_move():
    source = FakeSource({
        after("e2e4"): ExplorerPosition(100, (ExplorerMove("c7c5", "c5", 80),)),
        after("e2e4", "c7c5"): ExplorerPosition(
            80, (ExplorerMove("g1f3", "Nf3", 60),)
        ),
    })
    config = GeneratorConfig(
        name="White ending",
        color="white",
        max_lines=1,
        max_ply=2,
        min_games=1,
        min_frequency=0,
    )

    result = generate_candidate(["e4"], config, source)

    assert result.lines == [["e2e4", "c7c5", "g1f3"]]


def test_generator_finishes_black_repertoire_line_on_black_move():
    source = FakeSource({
        after("e2e4"): ExplorerPosition(100, (ExplorerMove("c7c5", "c5", 80),)),
    })
    config = GeneratorConfig(
        name="Black ending",
        color="black",
        max_lines=1,
        max_ply=2,
        min_games=1,
        min_frequency=0,
    )

    result = generate_candidate(["e4"], config, source)

    assert result.lines == [["e2e4", "c7c5"]]


def test_sparse_player_move_is_kept_below_opponent_sample_threshold():
    source = FakeSource({
        after("e2e4"): ExplorerPosition(100, (ExplorerMove("c7c5", "c5", 80),)),
        after("e2e4", "c7c5"): ExplorerPosition(
            10, (ExplorerMove("g1f3", "Nf3", 9),)
        ),
    })
    config = GeneratorConfig(
        name="Sparse response",
        color="white",
        max_lines=1,
        max_ply=2,
        min_games=20,
        min_frequency=0.01,
    )

    result = generate_candidate(["e4"], config, source)

    assert result.lines == [["e2e4", "c7c5", "g1f3"]]
    assert result.reports[-1].reason == "sparse_elite_fallback_choice"


def test_generator_distinguishes_reply_limit_from_frequency_threshold():
    position = after("e2e4")
    source = FakeSource(
        {
            position: ExplorerPosition(
                100,
                (
                    ExplorerMove("c7c5", "c5", 50),
                    ExplorerMove("e7e5", "e5", 30),
                    ExplorerMove("e7e6", "e6", 20),
                ),
            )
        }
    )
    reply_limited = generate_candidate(
        ["e4"],
        GeneratorConfig(
            name="Reply limited",
            color="white",
            coverage=0.9,
            max_lines=10,
            max_ply=2,
            min_games=1,
            min_frequency=0,
            max_opponent_replies=1,
        ),
        source,
    )
    threshold_limited = generate_candidate(
        ["e4"],
        GeneratorConfig(
            name="Threshold limited",
            color="white",
            coverage=0.9,
            max_lines=10,
            max_ply=2,
            min_games=40,
            min_frequency=0,
        ),
        source,
    )

    assert reply_limited.reports[0].reason == "reply_limit_reached"
    assert reply_limited.summary_payload()["replyLimitReached"] == 1
    assert threshold_limited.reports[0].reason == "frequency_threshold_limited"
    assert threshold_limited.summary_payload()["frequencyThresholdLimited"] == 1


def test_generator_rejects_bad_prefix_and_prefix_at_depth_limit():
    config = GeneratorConfig(name="Bad", color="white", max_ply=1)
    with pytest.raises(GenerationError, match="Illegal or invalid"):
        generate_candidate(["e5"], config, FakeSource({}))
    with pytest.raises(GenerationError, match="before max_ply"):
        generate_candidate(["e4"], config, FakeSource({}))
