"""Global, review-first ranking for repertoire gap-filling proposals."""

from __future__ import annotations

import math
from dataclasses import dataclass

import chess

from common.fen import normalize_fen

from .opening_generator import ExplorerPosition, PositionSource


def _complete_fen(fen: str) -> str:
    return fen if len(fen.split()) >= 6 else f"{fen} 0 1"


def position_distance(left_fen: str, right_fen: str) -> int | None:
    """Piece-placement Hamming distance for positions with the same side to move."""
    left = chess.Board(_complete_fen(left_fen))
    right = chess.Board(_complete_fen(right_fen))
    if left.turn != right.turn:
        return None
    return sum(left.piece_at(square) != right.piece_at(square) for square in chess.SQUARES)


@dataclass(frozen=True)
class GapCandidate:
    id: str
    gap_key: str
    path_uci: tuple[str, ...]
    resulting_fen: str
    reach_rate: float
    response_rate: float
    move_games: int
    engine_loss_cp: int | None = None
    depth: int = 0
    gap_missing_rate: float = 0
    kind: str = "response"
    base_ply: int = 0

    @property
    def marginal_coverage(self) -> float:
        return self.reach_rate * self.response_rate


@dataclass(frozen=True)
class GapProposal:
    candidate: GapCandidate
    score: float
    new_move_count: int
    exact_transposition: bool
    similar_fen: str | None
    similarity_distance: int | None

    def payload(self) -> dict:
        return {
            "id": self.candidate.id,
            "gapKey": self.candidate.gap_key,
            "pathUci": list(self.candidate.path_uci),
            "resultingFen": normalize_fen(self.candidate.resulting_fen),
            "reachRate": self.candidate.reach_rate,
            "responseRate": self.candidate.response_rate,
            "moveGames": self.candidate.move_games,
            "marginalCoverage": self.candidate.marginal_coverage,
            "engineLossCp": self.candidate.engine_loss_cp,
            "depth": self.candidate.depth,
            "gapMissingRate": self.candidate.gap_missing_rate,
            "kind": self.candidate.kind,
            "basePly": self.candidate.base_ply,
            "score": self.score,
            "newMoveCount": self.new_move_count,
            "exactTransposition": self.exact_transposition,
            "similarFen": self.similar_fen,
            "similarityDistance": self.similarity_distance,
        }


def discover_module_gaps(
    existing_paths: list[tuple[str, ...]],
    prefix: tuple[str, ...],
    color: str,
    source: PositionSource,
    *,
    min_games: int = 20,
    min_frequency: float = 0.01,
    max_opponent_replies: int = 8,
    requested_coverage: float = 0.95,
    evaluations: dict[str, tuple[str, int]] | None = None,
    minimum_score: float = 15,
    evaluation_weight: float = 10,
    minimum_evaluation: float = -1,
    initial_white_evaluation: float = 0,
) -> list[GapCandidate]:
    """Find real uncovered opponent replies in the authored module.

    Reach is conditional on arriving at ``prefix`` and multiplies only observed
    opponent replies. The popularity of authored repertoire-side choices is
    deliberately ignored, matching the coverage dashboard's probability model.
    Transposed occurrences share one FEN-keyed gap while retaining a legal
    authored path as the proposal prefix.
    """
    repertoire_turn = chess.WHITE if color == "white" else chess.BLACK
    repertoire_sign = 1 if color == "white" else -1
    evaluations = evaluations or {}

    def qualifies(fen: str, ply: int) -> bool:
        evaluation = evaluations.get(normalize_fen(fen))
        if not evaluation:
            return False
        score_type, score_value = evaluation
        if score_type == "mate":
            pawns = math.inf if score_value * repertoire_sign > 0 else -math.inf
        else:
            pawns = score_value * repertoire_sign / 100
        adjusted = pawns - repertoire_sign * initial_white_evaluation
        return adjusted >= minimum_evaluation and ply + evaluation_weight * adjusted >= minimum_score
    scoped_paths = [path for path in existing_paths if path[: len(prefix)] == prefix]
    if not scoped_paths:
        return []

    lookup_cache: dict[str, ExplorerPosition] = {}

    def lookup(board: chess.Board) -> ExplorerPosition:
        key = normalize_fen(board.fen(en_passant="legal"))
        if key not in lookup_cache:
            lookup_cache[key] = source.lookup(board)
        return lookup_cache[key]

    # A reply is prepared only when the authored opponent edge has a following
    # repertoire-side response. Merely ending a line after the opponent move is
    # still a gap.
    prepared_by_fen: dict[str, set[str]] = {}
    occurrences: dict[str, list[tuple[tuple[str, ...], float]]] = {}
    terminal_candidates: dict[tuple[str, ...], GapCandidate] = {}
    for path in scoped_paths:
        board = chess.Board()
        reach = 1.0
        minimum_sample = math.inf
        covered = False
        for ply, uci in enumerate(path):
            in_scope = ply >= len(prefix)
            fen = normalize_fen(board.fen(en_passant="legal"))
            if in_scope and not covered and board.turn != repertoire_turn:
                occurrences.setdefault(fen, []).append((path[:ply], reach))
                if ply + 1 < len(path):
                    prepared_by_fen.setdefault(fen, set()).add(uci)
                position = lookup(board)
                minimum_sample = min(minimum_sample, position.total_games)
                move_games = next((move.games for move in position.moves if move.uci == uci), 0)
                if position.total_games > 0:
                    reach *= move_games / position.total_games
            board.push_uci(uci)
            if in_scope and board.turn != repertoire_turn and qualifies(
                board.fen(en_passant="legal"), ply + 1
            ):
                covered = True
        if not covered and board.turn != repertoire_turn:
            # A line ending after our move is a 100%-missing opponent position.
            # Discover its replies exactly like any other response gap.
            normalized = normalize_fen(board.fen(en_passant="legal"))
            occurrences.setdefault(normalized, []).append((path, reach))
        elif not covered:
            # A line ending after an opponent move (or an empty White module at
            # the initial position) needs an immediate repertoire response.
            normalized = normalize_fen(board.fen(en_passant="legal"))
            terminal_candidates[path] = GapCandidate(
                id=f"terminal|{' '.join(path)}",
                gap_key=f"terminal|{normalized}",
                path_uci=path,
                resulting_fen=board.fen(en_passant="legal"),
                reach_rate=reach,
                response_rate=1,
                move_games=int(minimum_sample) if math.isfinite(minimum_sample) else 0,
                depth=len(path),
                gap_missing_rate=1,
                kind="terminal",
            )

    candidates: list[GapCandidate] = []
    for fen, paths in occurrences.items():
        board = chess.Board(_complete_fen(fen))
        position = lookup(board)
        if position.total_games <= 0:
            continue
        prepared = prepared_by_fen.get(fen, set())
        # Several move orders can transpose into the same position. Count the
        # position once and cap combined path reach at certainty.
        reach = min(1.0, sum(dict(paths).values()))
        origin_path = min((path for path, _ in paths), key=lambda path: (len(path), path))
        eligible = [
            move
            for move in position.moves
            if move.games >= min_games and move.games / position.total_games >= min_frequency
        ][:max_opponent_replies]
        prepared_games = sum(move.games for move in eligible if move.uci in prepared)
        missing_rate = max(0.0, 1 - prepared_games / position.total_games)
        selected_uncovered = []
        covered_games = prepared_games
        for move in eligible:
            if move.uci in prepared:
                continue
            if covered_games / position.total_games >= requested_coverage:
                break
            selected_uncovered.append(move)
            covered_games += move.games
        for move in selected_uncovered:
            child = board.copy(stack=False)
            parsed = chess.Move.from_uci(move.uci)
            if parsed not in child.legal_moves:
                continue
            child.push(parsed)
            path = (*origin_path, move.uci)
            candidates.append(GapCandidate(
                id=f"{fen}|{move.uci}",
                gap_key=f"{fen}|{move.uci}",
                path_uci=path,
                resulting_fen=child.fen(en_passant="legal"),
                reach_rate=reach,
                response_rate=move.games / position.total_games,
                move_games=move.games,
                depth=len(origin_path),
                gap_missing_rate=missing_rate,
            ))
    response_paths = {candidate.path_uci for candidate in candidates}
    candidates.extend(
        candidate for candidate in terminal_candidates.values()
        if candidate.path_uci not in response_paths
    )
    return sorted(
        candidates,
        key=lambda candidate: (
            -(candidate.reach_rate * candidate.gap_missing_rate),
            candidate.depth,
            -candidate.marginal_coverage,
            -candidate.move_games,
            candidate.id,
        ),
    )


def path_edges(path: tuple[str, ...]) -> set[tuple[str, ...]]:
    return {path[:index] for index in range(1, len(path) + 1)}


def position_edges(path: tuple[str, ...]) -> set[tuple[str, str]]:
    """Identify learned edges by position and move, not by move-order prefix."""
    board = chess.Board()
    edges = set()
    for uci in path:
        edges.add((normalize_fen(board.fen(en_passant="legal")), uci))
        board.push_uci(uci)
    return edges


def rank_gap_candidates(
    candidates: list[GapCandidate],
    existing_paths: list[tuple[str, ...]],
    repertoire_fens: set[str],
    *,
    move_budget: int,
    max_engine_loss_cp: int = 35,
    similarity_max_distance: int = 6,
    familiarity_weight: float = 0.25,
) -> list[GapProposal]:
    """Greedily maximize reliable marginal coverage per newly learned move.

    Scores are recomputed after every selection, so shared prefixes and exact
    transpositions become cheaper as proposals are accepted. Only one proposal
    is selected for a given gap; conflicts remain review decisions upstream.
    """
    if move_budget < 1:
        return []
    existing_edges = (
        set().union(*(position_edges(path) for path in existing_paths))
        if existing_paths
        else set()
    )
    normalized_fens = {normalize_fen(fen) for fen in repertoire_fens}
    available = [
        candidate
        for candidate in candidates
        if candidate.engine_loss_cp is None or candidate.engine_loss_cp <= max_engine_loss_cp
    ]
    selected: list[GapProposal] = []
    selected_edges: set[tuple[str, str]] = set()
    filled_gaps: set[str] = set()
    remaining_budget = move_budget

    while True:
        best: GapProposal | None = None
        for candidate in available:
            if candidate.gap_key in filled_gaps:
                continue
            new_edges = position_edges(candidate.path_uci) - existing_edges - selected_edges
            new_move_count = len(new_edges)
            if new_move_count > remaining_budget:
                continue
            normalized_result = normalize_fen(candidate.resulting_fen)
            exact = normalized_result in normalized_fens
            similar_fen = None
            similarity_distance = None
            if not exact:
                for fen in normalized_fens:
                    distance = position_distance(normalized_result, fen)
                    if distance is not None and (
                        similarity_distance is None or distance < similarity_distance
                    ):
                        similar_fen = fen
                        similarity_distance = distance
            familiarity = 1.0
            if exact:
                familiarity += familiarity_weight
            elif similarity_distance is not None and similarity_distance <= similarity_max_distance:
                familiarity += familiarity_weight * (1 - similarity_distance / (similarity_max_distance + 1))
            reliability = math.log1p(max(0, candidate.move_games))
            score = candidate.marginal_coverage * reliability * familiarity / max(1, new_move_count)
            proposal = GapProposal(
                candidate=candidate,
                score=score,
                new_move_count=new_move_count,
                exact_transposition=exact,
                similar_fen=similar_fen,
                similarity_distance=similarity_distance,
            )
            if best is None or (proposal.score, candidate.move_games, candidate.id) > (
                best.score,
                best.candidate.move_games,
                best.candidate.id,
            ):
                best = proposal
        if best is None:
            break
        selected.append(best)
        edges = position_edges(best.candidate.path_uci) - existing_edges - selected_edges
        selected_edges.update(edges)
        remaining_budget -= len(edges)
        filled_gaps.add(best.candidate.gap_key)

    return selected


def candidates_from_generated_tree(result, existing_paths: list[tuple[str, ...]]) -> list[GapCandidate]:
    """Turn newly generated leaves into gap candidates with explorer-derived exposure."""
    existing_edges = set().union(*(path_edges(path) for path in existing_paths)) if existing_paths else set()
    reports = {report.fen: report for report in result.reports}
    candidates: list[GapCandidate] = []
    for index, raw_path in enumerate(result.lines):
        path = tuple(raw_path)
        first_missing = next(
            (ply for ply in range(1, len(path) + 1) if path[:ply] not in existing_edges),
            None,
        )
        if first_missing is None:
            continue
        board = chess.Board()
        path_rate = 1.0
        reach_rate = 1.0
        response_rate = 1.0
        move_games = 0
        for ply, uci in enumerate(path, start=1):
            report = reports.get(normalize_fen(board.fen(en_passant="legal")))
            move = next(
                (
                    item
                    for item in [*(report.included if report else []), *(report.omitted if report else [])]
                    if item["uci"] == uci
                ),
                None,
            )
            if move and report and report.total_games:
                rate = move["games"] / report.total_games
                if ply == first_missing:
                    reach_rate = path_rate
                    response_rate = rate
                    move_games = move["games"]
                path_rate *= rate
            board.push_uci(uci)
        candidates.append(
            GapCandidate(
                id=str(index),
                gap_key=" ".join(path[: first_missing - 1]),
                path_uci=path,
                resulting_fen=board.fen(en_passant="legal"),
                reach_rate=reach_rate,
                response_rate=response_rate,
                move_games=move_games,
            )
        )
    return candidates
