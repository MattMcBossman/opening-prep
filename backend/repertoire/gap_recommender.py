"""Global, review-first ranking for repertoire gap-filling proposals."""

from __future__ import annotations

import math
from dataclasses import dataclass

import chess

from common.fen import normalize_fen


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
            "score": self.score,
            "newMoveCount": self.new_move_count,
            "exactTransposition": self.exact_transposition,
            "similarFen": self.similar_fen,
            "similarityDistance": self.similarity_distance,
        }


def path_edges(path: tuple[str, ...]) -> set[tuple[str, ...]]:
    return {path[:index] for index in range(1, len(path) + 1)}


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
    existing_edges = set().union(*(path_edges(path) for path in existing_paths)) if existing_paths else set()
    normalized_fens = {normalize_fen(fen) for fen in repertoire_fens}
    available = [
        candidate
        for candidate in candidates
        if candidate.engine_loss_cp is None or candidate.engine_loss_cp <= max_engine_loss_cp
    ]
    selected: list[GapProposal] = []
    selected_edges: set[tuple[str, ...]] = set()
    filled_gaps: set[str] = set()
    remaining_budget = move_budget

    while True:
        best: GapProposal | None = None
        for candidate in available:
            if candidate.gap_key in filled_gaps:
                continue
            new_edges = path_edges(candidate.path_uci) - existing_edges - selected_edges
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
        edges = path_edges(best.candidate.path_uci) - existing_edges - selected_edges
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
