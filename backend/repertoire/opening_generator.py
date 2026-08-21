"""Generate reviewable opening-repertoire candidates from explorer statistics."""

from __future__ import annotations

import heapq
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Protocol

import chess
import chess.engine
import chess.pgn
import requests

from common.fen import normalize_fen


class GenerationError(Exception):
    """The candidate could not be generated from the supplied inputs."""


@dataclass(frozen=True)
class ExplorerMove:
    uci: str
    san: str
    games: int


@dataclass(frozen=True)
class ExplorerPosition:
    total_games: int
    moves: tuple[ExplorerMove, ...]


class PositionSource(Protocol):
    def lookup(self, board: chess.Board) -> ExplorerPosition: ...


class MoveEvaluator(Protocol):
    name: str

    def scores(self, board: chess.Board, moves: list[chess.Move]) -> dict[str, int]: ...

    def close(self) -> None: ...


class LichessPositionSource:
    """Small direct client used by the offline curator command."""

    def __init__(
        self,
        url: str,
        token: str,
        *,
        ratings: str | None = None,
        speeds: str | None = None,
        timeout: int = 15,
    ):
        self.url = url
        self.token = token
        self.ratings = ratings
        self.speeds = speeds
        self.timeout = timeout

    def lookup(self, board: chess.Board) -> ExplorerPosition:
        params = {
            "fen": board.fen(en_passant="legal"),
            "moves": 30,
            "topGames": 0,
            "recentGames": 0,
        }
        if self.ratings:
            params["ratings"] = self.ratings
        if self.speeds:
            params["speeds"] = self.speeds
        try:
            response = requests.get(
                self.url,
                params=params,
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise GenerationError(f"Lichess explorer request failed: {exc}") from exc
        if response.status_code == 429:
            raise GenerationError("Lichess explorer rate limit reached; wait before retrying.")
        if not response.ok:
            raise GenerationError(f"Lichess explorer returned HTTP {response.status_code}.")
        try:
            payload = response.json()
        except ValueError as exc:
            raise GenerationError("Lichess explorer returned invalid JSON.") from exc

        moves = []
        for item in payload.get("moves") or []:
            games = sum(int(item.get(key) or 0) for key in ("white", "draws", "black"))
            if item.get("uci") and item.get("san") and games:
                moves.append(ExplorerMove(item["uci"], item["san"], games))
        moves.sort(key=lambda move: (-move.games, move.uci))
        total = sum(int(payload.get(key) or 0) for key in ("white", "draws", "black"))
        return ExplorerPosition(total_games=total, moves=tuple(moves))


class StockfishEvaluator:
    """Evaluate explorer candidates from the repertoire side's point of view."""

    name = "stockfish"

    def __init__(self, executable: str, color: chess.Color, *, depth: int = 16):
        try:
            self.engine = chess.engine.SimpleEngine.popen_uci(executable)
        except (OSError, chess.engine.EngineError) as exc:
            raise GenerationError(f"Could not start Stockfish at {executable!r}: {exc}") from exc
        self.color = color
        self.depth = depth

    def scores(self, board: chess.Board, moves: list[chess.Move]) -> dict[str, int]:
        scores = {}
        for move in moves:
            try:
                result = self.engine.analyse(
                    board,
                    chess.engine.Limit(depth=self.depth),
                    root_moves=[move],
                )
            except chess.engine.EngineError as exc:
                raise GenerationError(f"Stockfish analysis failed: {exc}") from exc
            score = result["score"].pov(self.color).score(mate_score=100_000)
            if score is not None:
                scores[move.uci()] = score
        return scores

    def close(self) -> None:
        self.engine.quit()


@dataclass
class GeneratorConfig:
    name: str
    color: str
    max_lines: int = 50
    max_ply: int = 24
    coverage: float = 0.60
    min_games: int = 20
    min_frequency: float = 0.01
    max_opponent_replies: int = 8
    max_engine_loss_cp: int = 35
    engine_candidates: int = 5

    def validate(self) -> None:
        if self.color not in {"white", "black"}:
            raise GenerationError("color must be 'white' or 'black'.")
        if self.max_lines < 1 or self.max_ply < 1:
            raise GenerationError("max_lines and max_ply must be positive.")
        if not 0 < self.coverage <= 1:
            raise GenerationError("coverage must be greater than 0 and at most 1.")
        if self.min_games < 1 or not 0 <= self.min_frequency <= 1:
            raise GenerationError("min_games must be positive and min_frequency must be between 0 and 1.")


@dataclass
class NodeReport:
    fen: str
    ply: int
    turn: str
    total_games: int
    included: list[dict]
    omitted: list[dict]
    covered_fraction: float
    reason: str


@dataclass
class GenerationResult:
    name: str
    color: str
    prefix_uci: list[str]
    lines: list[list[str]]
    reports: list[NodeReport]
    settings: dict
    engine: str | None

    def summary_payload(self) -> dict:
        opponent_turn = "black" if self.color == "white" else "white"
        opponent_reports = [report for report in self.reports if report.turn == opponent_turn]
        sampled = [report.covered_fraction for report in opponent_reports if report.total_games > 0]
        reasons = {
            reason: sum(report.reason == reason for report in opponent_reports)
            for reason in (
                "coverage_target_met",
                "leaf_budget_limited",
                "reply_limit_reached",
                "frequency_threshold_limited",
                "no_eligible_moves",
            )
        }
        return {
            "positionsAnalyzed": len(self.reports),
            "opponentPositions": len(opponent_reports),
            "coverageTargetMet": reasons["coverage_target_met"],
            "leafBudgetLimited": reasons["leaf_budget_limited"],
            "replyLimitReached": reasons["reply_limit_reached"],
            "frequencyThresholdLimited": reasons["frequency_threshold_limited"],
            "noEligibleMoves": reasons["no_eligible_moves"],
            "minimumOpponentCoverage": round(min(sampled), 6) if sampled else None,
            "averageOpponentCoverage": round(sum(sampled) / len(sampled), 6) if sampled else None,
            "maximumGeneratedPly": max((len(line) for line in self.lines), default=len(self.prefix_uci)),
        }

    def report_payload(self) -> dict:
        return {
            "name": self.name,
            "color": self.color,
            "prefixUci": self.prefix_uci,
            "leafCount": len(self.lines),
            "lines": self.lines,
            "generation": self.settings,
            "engine": self.engine,
            "summary": self.summary_payload(),
            "positions": [asdict(report) for report in self.reports],
        }

    def report_json(self) -> str:
        return json.dumps(self.report_payload(), indent=2) + "\n"

    def pgn(self) -> str:
        game = chess.pgn.Game()
        game.headers["Event"] = self.name
        game.headers["Result"] = "*"
        game.headers["MainlineGenerator"] = "Mainline"
        for path in self.lines:
            board = chess.Board()
            node: chess.pgn.GameNode = game
            for uci in path:
                move = chess.Move.from_uci(uci)
                existing = next((child for child in node.variations if child.move == move), None)
                node = existing or node.add_variation(move)
                board.push(move)
        exporter = chess.pgn.StringExporter(headers=True, variations=True, comments=True)
        return game.accept(exporter).rstrip() + "\n"

    def write(self, pgn_path: Path, report_path: Path | None = None) -> tuple[Path, Path]:
        report_path = report_path or pgn_path.with_suffix(".report.json")
        pgn_path.write_text(self.pgn(), encoding="utf-8")
        report_path.write_text(self.report_json(), encoding="utf-8")
        return pgn_path, report_path


@dataclass(order=True)
class _Leaf:
    priority: tuple[float, int, int]
    serial: int
    board: chess.Board = field(compare=False)
    path: list[str] = field(compare=False)
    probability: float = field(compare=False)


def parse_prefix(tokens: list[str]) -> tuple[chess.Board, list[str]]:
    """Parse a mixed SAN/UCI move prefix from the standard initial position."""
    board = chess.Board()
    uci_path = []
    for token in tokens:
        try:
            move = chess.Move.from_uci(token)
            if move not in board.legal_moves:
                raise ValueError
        except ValueError:
            try:
                move = board.parse_san(token)
            except ValueError as exc:
                raise GenerationError(f"Illegal or invalid prefix move {token!r}.") from exc
        uci_path.append(move.uci())
        board.push(move)
    return board, uci_path


def _move_payload(move: ExplorerMove, total: int, score: int | None = None) -> dict:
    payload = {
        "uci": move.uci,
        "san": move.san,
        "games": move.games,
        "frequency": round(move.games / total, 6) if total else 0,
    }
    if score is not None:
        payload["scoreCp"] = score
    return payload


def generate_candidate(
    prefix: list[str],
    config: GeneratorConfig,
    source: PositionSource,
    evaluator: MoveEvaluator | None = None,
) -> GenerationResult:
    """Build a bounded, best-first repertoire tree rooted at an opening prefix."""
    config.validate()
    start_board, prefix_uci = parse_prefix(prefix)
    if len(prefix_uci) >= config.max_ply:
        raise GenerationError("The prefix must end before max_ply.")

    repertoire_color = chess.WHITE if config.color == "white" else chess.BLACK
    reports: list[NodeReport] = []
    serial = 0

    def leaf(board: chess.Board, path: list[str], probability: float) -> _Leaf:
        nonlocal serial
        serial += 1
        # Prefer likely branches, then shallower branches, with serial as a stable tiebreaker.
        return _Leaf((-probability, len(path), serial), serial, board, path, probability)

    queue = [leaf(start_board, prefix_uci, 1.0)]
    finished: list[list[str]] = []
    leaf_count = 1

    while queue:
        current = heapq.heappop(queue)
        board = current.board
        if len(current.path) >= config.max_ply or board.is_game_over():
            finished.append(current.path)
            continue

        position = source.lookup(board)
        legal = []
        for item in position.moves:
            try:
                move = chess.Move.from_uci(item.uci)
            except ValueError:
                continue
            if move in board.legal_moves:
                legal.append((item, move))
        total = position.total_games or sum(item.games for item, _ in legal)
        eligible = [
            pair
            for pair in legal
            if pair[0].games >= config.min_games
            and (not total or pair[0].games / total >= config.min_frequency)
        ]
        turn = "white" if board.turn == chess.WHITE else "black"

        if not eligible:
            reports.append(
                NodeReport(
                    normalize_fen(board.fen(en_passant="legal")),
                    len(current.path),
                    turn,
                    total,
                    [],
                    [_move_payload(item, total) for item, _ in legal],
                    0,
                    "no_eligible_moves",
                )
            )
            finished.append(current.path)
            continue

        scores: dict[str, int] = {}
        if board.turn == repertoire_color:
            candidates = eligible[: config.engine_candidates]
            if evaluator:
                scores = evaluator.scores(board, [move for _, move in candidates])
            if scores:
                best = max(scores.values())
                sound = [
                    pair
                    for pair in candidates
                    if scores.get(pair[0].uci, -1_000_000) >= best - config.max_engine_loss_cp
                ]
                selected = [max(sound, key=lambda pair: (pair[0].games, pair[0].uci))]
                reason = "popular_engine_sound_choice"
            else:
                selected = [eligible[0]]
                reason = "most_popular_choice"
        else:
            available = max(1, config.max_lines - leaf_count + 1)
            selected = []
            covered = 0
            for pair in eligible[: config.max_opponent_replies]:
                if len(selected) >= available:
                    break
                selected.append(pair)
                covered += pair[0].games
                if total and covered / total >= config.coverage:
                    break
            covered_fraction = covered / total if total else 0
            if total and covered_fraction >= config.coverage:
                reason = "coverage_target_met"
            elif len(selected) >= available and len(selected) < len(eligible):
                reason = "leaf_budget_limited"
            elif len(selected) >= config.max_opponent_replies and len(selected) < len(eligible):
                reason = "reply_limit_reached"
            else:
                reason = "frequency_threshold_limited"

        selected_uci = {item.uci for item, _ in selected}
        included = [_move_payload(item, total, scores.get(item.uci)) for item, _ in selected]
        omitted = [
            _move_payload(item, total, scores.get(item.uci))
            for item, _ in legal
            if item.uci not in selected_uci
        ]
        reports.append(
            NodeReport(
                normalize_fen(board.fen(en_passant="legal")),
                len(current.path),
                turn,
                total,
                included,
                omitted,
                round(sum(item.games for item, _ in selected) / total, 6) if total else 0,
                reason,
            )
        )

        leaf_count += len(selected) - 1
        for item, move in selected:
            child = board.copy(stack=False)
            child.push(move)
            probability = current.probability * (item.games / total if total else 1.0)
            heapq.heappush(queue, leaf(child, [*current.path, move.uci()], probability))

    lines = sorted(finished, key=lambda path: (len(path), path))
    return GenerationResult(
        name=config.name,
        color=config.color,
        prefix_uci=prefix_uci,
        lines=lines,
        reports=reports,
        settings=asdict(config),
        engine=evaluator.name if evaluator else None,
    )
