"""Generate reviewable opening-repertoire candidates from explorer statistics."""

from __future__ import annotations

import heapq
import json
import time
from collections.abc import Callable
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

    def best_move(self, board: chess.Board) -> tuple[chess.Move, int] | None: ...

    def close(self) -> None: ...


class RequestPacer:
    """Share one upstream cadence across sources using the same Lichess token."""

    def __init__(self, interval: float, sleep: Callable[[float], None] = time.sleep):
        self.interval = interval
        self.sleep = sleep
        self.next_request_at = 0.0

    def wait(self) -> None:
        delay = self.next_request_at - time.monotonic()
        if delay > 0:
            self.sleep(delay)

    def completed(self) -> None:
        self.next_request_at = time.monotonic() + self.interval


class RepertoirePositionSource:
    """Use elite games for our choices and population games for opponent reach."""

    def __init__(self, color: str, elite: PositionSource, population: PositionSource):
        self.repertoire_turn = chess.WHITE if color == "white" else chess.BLACK
        self.elite = elite
        self.population = population

    def lookup(self, board: chess.Board) -> ExplorerPosition:
        if board.turn != self.repertoire_turn:
            return self.population.lookup(board)
        elite = self.elite.lookup(board)
        return elite if elite.moves else self.population.lookup(board)

    def population_lookup(self, board: chess.Board) -> ExplorerPosition:
        return self.population.lookup(board)


def _replies_needed_for_coverage(position: ExplorerPosition, coverage: float) -> int | None:
    if position.total_games <= 0:
        return None
    covered = 0
    for index, move in enumerate(position.moves, start=1):
        covered += move.games
        if covered / position.total_games >= coverage:
            return index
    return len(position.moves) or None


def _select_repertoire_move(
    board: chess.Board,
    candidates: list[tuple[ExplorerMove, chess.Move]],
    source: PositionSource,
    coverage: float,
    scores: dict[str, int],
) -> tuple[ExplorerMove, chess.Move]:
    """Balance quality, surprise, and the cost of covering likely replies."""
    population_lookup = getattr(source, "population_lookup", source.lookup)
    population = population_lookup(board)
    population_games = {move.uci: move.games for move in population.moves}
    max_elite_games = max((item.games for item, _ in candidates), default=1)
    score_floor = min(scores.values()) if scores else 0
    score_range = max(scores.values()) - score_floor if scores else 0

    ranked = []
    for item, move in candidates:
        child = board.copy(stack=False)
        child.push(move)
        replies_needed = _replies_needed_for_coverage(source.lookup(child), coverage)
        efficiency = 1 / replies_needed if replies_needed else 0
        population_frequency = (
            population_games.get(item.uci, 0) / population.total_games
            if population.total_games
            else 0
        )
        surprise = 1 - population_frequency
        quality = (
            (scores[item.uci] - score_floor) / score_range
            if scores and score_range
            else item.games / max_elite_games
        )
        utility = 0.45 * quality + 0.40 * efficiency + 0.15 * surprise
        ranked.append((utility, quality, efficiency, item.games, item.uci, (item, move)))
    return max(ranked)[-1]


class LichessPositionSource:
    """Small direct client used by the offline curator command."""

    def __init__(
        self,
        url: str,
        token: str,
        *,
        ratings: str | None = None,
        speeds: str | None = None,
        moves: int = 30,
        timeout: int = 15,
        on_rate_limit: Callable[[int], None] | None = None,
        max_rate_limit_wait: int = 180,
        min_request_interval: float = 0,
        cache_lookup: Callable[[chess.Board], ExplorerPosition | None] | None = None,
        cache_store: Callable[[chess.Board, dict], None] | None = None,
        request_pacer: RequestPacer | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.url = url
        self.token = token
        self.ratings = ratings
        self.speeds = speeds
        self.moves = moves
        self.timeout = timeout
        self.on_rate_limit = on_rate_limit
        self.max_rate_limit_wait = max_rate_limit_wait
        self.min_request_interval = min_request_interval
        self.cache_lookup = cache_lookup
        self.cache_store = cache_store
        self.request_pacer = request_pacer
        self.sleep = sleep
        self._cache: dict[str, ExplorerPosition] = {}
        self._next_request_at = 0.0
        self._rate_limit_waited = 0

    def lookup(self, board: chess.Board) -> ExplorerPosition:
        cache_key = normalize_fen(board.fen(en_passant="legal"))
        if cache_key in self._cache:
            return self._cache[cache_key]
        if self.cache_lookup:
            cached = self.cache_lookup(board)
            if cached is not None:
                self._cache[cache_key] = cached
                return cached
        params = {
            "fen": board.fen(en_passant="legal"),
            "moves": self.moves,
            "topGames": 0,
            "recentGames": 0,
        }
        if self.ratings:
            params["ratings"] = self.ratings
        if self.speeds:
            params["speeds"] = self.speeds
        while True:
            if self.request_pacer:
                self.request_pacer.wait()
            else:
                pacing_wait = self._next_request_at - time.monotonic()
                if pacing_wait > 0:
                    self.sleep(pacing_wait)
            try:
                response = requests.get(
                    self.url,
                    params=params,
                    headers={"Authorization": f"Bearer {self.token}"},
                    timeout=self.timeout,
                )
            except requests.RequestException as exc:
                raise GenerationError(f"Lichess explorer request failed: {exc}") from exc
            if self.request_pacer:
                self.request_pacer.completed()
            if response.status_code != 429:
                self._next_request_at = time.monotonic() + self.min_request_interval
                break
            try:
                retry_after = max(1, int(response.headers.get("Retry-After", "30")))
            except ValueError:
                retry_after = 30
            if self._rate_limit_waited + retry_after > self.max_rate_limit_wait:
                raise GenerationError(
                    "Lichess kept rate-limiting this generation after "
                    f"{self._rate_limit_waited} seconds of automatic retries. Try again later."
                )
            for remaining in range(retry_after, 0, -1):
                if self.on_rate_limit:
                    self.on_rate_limit(remaining)
                self.sleep(1)
            if self.on_rate_limit:
                self.on_rate_limit(0)
            self._rate_limit_waited += retry_after
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
        result = ExplorerPosition(total_games=total, moves=tuple(moves))
        self._cache[cache_key] = result
        if self.cache_store:
            self.cache_store(board, payload)
        return result


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

    def best_move(self, board: chess.Board) -> tuple[chess.Move, int] | None:
        try:
            result = self.engine.analyse(board, chess.engine.Limit(depth=self.depth))
        except chess.engine.EngineError as exc:
            raise GenerationError(f"Stockfish analysis failed: {exc}") from exc
        pv = result.get("pv") or []
        score = result["score"].pov(self.color).score(mate_score=100_000)
        return (pv[0], score) if pv and score is not None else None

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
    on_progress: Callable[[int, int, list[str]], None] | None = None,
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

    def ends_with_repertoire_move(path: list[str]) -> bool:
        if not path:
            return False
        last_mover = chess.WHITE if len(path) % 2 else chess.BLACK
        return last_mover == repertoire_color

    while queue:
        current = heapq.heappop(queue)
        board = current.board
        if board.is_game_over():
            if ends_with_repertoire_move(current.path):
                finished.append(current.path)
            continue
        if len(current.path) >= config.max_ply and ends_with_repertoire_move(current.path):
            finished.append(current.path)
            continue

        if on_progress:
            on_progress(len(reports) + 1, len(queue) + 1, current.path)
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
        scores: dict[str, int] = {}
        sparse_player_fallback = False

        # Sample thresholds protect opponent-likelihood estimates. They should
        # not erase every possible repertoire response in a sparse deep
        # position: retain the strongest available player moves for Stockfish
        # and practical ranking instead.
        if not eligible and legal and board.turn == repertoire_color:
            eligible = legal[: config.engine_candidates]
            sparse_player_fallback = True

        if not eligible and evaluator:
            best_move = getattr(evaluator, "best_move", lambda _board: None)(board)
            if best_move:
                move, score = best_move
                scores = {move.uci(): score}
            else:
                engine_moves = list(board.legal_moves)[: config.engine_candidates]
                scores = evaluator.scores(board, engine_moves)
            if scores:
                chosen = next(iter(scores)) if best_move else (
                    max(scores, key=scores.get)
                    if board.turn == repertoire_color
                    else min(scores, key=scores.get)
                )
                move = chess.Move.from_uci(chosen)
                eligible = [(ExplorerMove(chosen, board.san(move), 0), move)]
                legal = eligible

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
            if ends_with_repertoire_move(current.path):
                finished.append(current.path)
            elif ends_with_repertoire_move(current.path[:-1]):
                finished.append(current.path[:-1])
            continue

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
                selected = [
                    _select_repertoire_move(board, sound, source, config.coverage, scores)
                ]
                reason = (
                    "sparse_engine_fallback_choice"
                    if sparse_player_fallback
                    else "balanced_engine_surprise_coverage_choice"
                )
            else:
                selected = [
                    _select_repertoire_move(board, candidates, source, config.coverage, scores)
                ]
                reason = (
                    "sparse_elite_fallback_choice"
                    if sparse_player_fallback
                    else "balanced_elite_surprise_coverage_choice"
                )
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

    lines = sorted({tuple(path) for path in finished}, key=lambda path: (len(path), path))
    return GenerationResult(
        name=config.name,
        color=config.color,
        prefix_uci=prefix_uci,
        lines=[list(path) for path in lines],
        reports=reports,
        settings=asdict(config),
        engine=evaluator.name if evaluator else None,
    )
