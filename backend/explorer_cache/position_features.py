"""Deterministic, server-owned concrete facts for a chess position."""

import hashlib
import json

import chess

from common.fen import normalize_fen

FEATURE_SCHEMA_VERSION = 1
FEATURE_EXTRACTOR_VERSION = "concrete-v2"
PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
}


def _side(color: chess.Color) -> str:
    return "white" if color == chess.WHITE else "black"


def _squares(board: chess.Board, piece_type: chess.PieceType, color: chess.Color) -> list[str]:
    return [chess.square_name(square) for square in sorted(board.pieces(piece_type, color))]


def _fact(
    kind: str,
    category: str,
    side: str,
    summary: str,
    *,
    squares: list[str],
    pieces: list[str],
    severity: str = "info",
    confidence: str = "certain",
    evidence: dict | None = None,
) -> dict:
    identity = f"{category}:{kind}:{side}:{','.join(squares)}"
    return {
        "id": identity,
        "category": category,
        "kind": kind,
        "side": side,
        "severity": severity,
        "confidence": confidence,
        "summary": summary,
        "squares": squares,
        "pieces": pieces,
        "evidence": evidence or {},
    }


def _material_facts(board: chess.Board) -> list[dict]:
    facts = []
    totals = {
        color: sum(len(board.pieces(piece_type, color)) * value for piece_type, value in PIECE_VALUES.items())
        for color in chess.COLORS
    }
    difference = totals[chess.WHITE] - totals[chess.BLACK]
    if difference:
        leader = chess.WHITE if difference > 0 else chess.BLACK
        facts.append(
            _fact(
                "material_advantage",
                "material",
                _side(leader),
                f"{_side(leader).title()} has a material advantage of about {abs(difference) / 100:g} pawns.",
                squares=[],
                pieces=[],
                severity="advantage",
                evidence={
                    "whiteCentipawns": totals[chess.WHITE],
                    "blackCentipawns": totals[chess.BLACK],
                    "differenceCentipawns": difference,
                },
            )
        )
    for color in chess.COLORS:
        bishops = _squares(board, chess.BISHOP, color)
        if len(bishops) >= 2:
            facts.append(
                _fact(
                    "bishop_pair",
                    "material",
                    _side(color),
                    f"{_side(color).title()} has the bishop pair.",
                    squares=bishops,
                    pieces=[f"{_side(color)} bishop" for _ in bishops],
                    evidence={"bishopCount": len(bishops)},
                )
            )
    return facts


def _is_passed(board: chess.Board, square: chess.Square, color: chess.Color) -> bool:
    file_index = chess.square_file(square)
    rank_index = chess.square_rank(square)
    enemy_pawns = board.pieces(chess.PAWN, not color)
    for enemy in enemy_pawns:
        if abs(chess.square_file(enemy) - file_index) > 1:
            continue
        enemy_rank = chess.square_rank(enemy)
        if (color == chess.WHITE and enemy_rank > rank_index) or (
            color == chess.BLACK and enemy_rank < rank_index
        ):
            return False
    return True


def _pawn_facts(board: chess.Board) -> list[dict]:
    facts = []
    for color in chess.COLORS:
        side = _side(color)
        pawns = sorted(board.pieces(chess.PAWN, color))
        pawns_by_file = {
            file_index: [square for square in pawns if chess.square_file(square) == file_index]
            for file_index in range(8)
        }
        for file_index, file_pawns in pawns_by_file.items():
            if len(file_pawns) >= 2:
                names = [chess.square_name(square) for square in file_pawns]
                facts.append(
                    _fact(
                        "doubled_pawns",
                        "pawns",
                        side,
                        f"{side.title()} has doubled pawns on the {chess.FILE_NAMES[file_index]}-file.",
                        squares=names,
                        pieces=[f"{side} pawn" for _ in names],
                        severity="weakness",
                        evidence={"file": chess.FILE_NAMES[file_index], "count": len(names)},
                    )
                )
        for square in pawns:
            name = chess.square_name(square)
            file_index = chess.square_file(square)
            adjacent = [
                candidate for candidate in pawns if abs(chess.square_file(candidate) - file_index) == 1
            ]
            if not adjacent:
                facts.append(
                    _fact(
                        "isolated_pawn",
                        "pawns",
                        side,
                        f"{side.title()}'s pawn on {name} is isolated.",
                        squares=[name],
                        pieces=[f"{side} pawn"],
                        severity="weakness",
                    )
                )
            if _is_passed(board, square, color):
                facts.append(
                    _fact(
                        "passed_pawn",
                        "pawns",
                        side,
                        f"{side.title()}'s pawn on {name} is passed.",
                        squares=[name],
                        pieces=[f"{side} pawn"],
                        severity="advantage",
                    )
                )
        connected_pairs = []
        for index, left in enumerate(pawns):
            for right in pawns[index + 1 :]:
                if (
                    abs(chess.square_file(left) - chess.square_file(right)) == 1
                    and abs(chess.square_rank(left) - chess.square_rank(right)) <= 1
                ):
                    connected_pairs.append((left, right))
        connected_squares = sorted({square for pair in connected_pairs for square in pair})
        if connected_squares:
            names = [chess.square_name(square) for square in connected_squares]
            facts.append(
                _fact(
                    "connected_pawns",
                    "pawns",
                    side,
                    f"{side.title()} has connected pawns on {', '.join(names)}.",
                    squares=names,
                    pieces=[f"{side} pawn" for _ in names],
                    evidence={
                        "pairs": [
                            [chess.square_name(left), chess.square_name(right)]
                            for left, right in connected_pairs
                        ]
                    },
                )
            )
    return facts


def _piece_label(piece: chess.Piece) -> str:
    return f"{_side(piece.color)} {chess.piece_name(piece.piece_type)}"


def _file_facts(board: chess.Board) -> list[dict]:
    facts = []
    for file_index, file_name in enumerate(chess.FILE_NAMES):
        file_squares = list(chess.SquareSet(chess.BB_FILES[file_index]))
        white_pawns = board.pieces(chess.PAWN, chess.WHITE) & chess.BB_FILES[file_index]
        black_pawns = board.pieces(chess.PAWN, chess.BLACK) & chess.BB_FILES[file_index]
        for color in chess.COLORS:
            own_pawns = white_pawns if color == chess.WHITE else black_pawns
            enemy_pawns = black_pawns if color == chess.WHITE else white_pawns
            users = sorted(
                square
                for square in file_squares
                if (piece := board.piece_at(square))
                and piece.color == color
                and piece.piece_type in {chess.ROOK, chess.QUEEN}
            )
            if own_pawns or not users:
                continue
            names = [chess.square_name(square) for square in users]
            pieces = [_piece_label(board.piece_at(square)) for square in users]
            if enemy_pawns:
                facts.append(
                    _fact(
                        "semi_open_file",
                        "files",
                        _side(color),
                        f"{_side(color).title()} uses the semi-open {file_name}-file with "
                        f"{', '.join(names)}.",
                        squares=names + [chess.square_name(square) for square in sorted(enemy_pawns)],
                        pieces=pieces + [f"{_side(not color)} pawn" for _ in enemy_pawns],
                        evidence={"file": file_name, "users": names},
                    )
                )
            else:
                facts.append(
                    _fact(
                        "open_file",
                        "files",
                        _side(color),
                        f"{_side(color).title()} uses the open {file_name}-file with {', '.join(names)}.",
                        squares=names,
                        pieces=pieces,
                        evidence={"file": file_name, "users": names},
                    )
                )
    return facts


def _board_for_turn(board: chess.Board, color: chess.Color) -> chess.Board:
    candidate = board.copy(stack=False)
    candidate.turn = color
    if color != board.turn:
        candidate.ep_square = None
    return candidate


def _activity_facts(board: chess.Board) -> list[dict]:
    facts = []
    starting_minors = {
        chess.WHITE: {chess.B1, chess.C1, chess.F1, chess.G1},
        chess.BLACK: {chess.B8, chess.C8, chess.F8, chess.G8},
    }
    mobility = {}
    for color in chess.COLORS:
        side = _side(color)
        undeveloped = sorted(
            square
            for square in starting_minors[color]
            if (piece := board.piece_at(square))
            and piece.color == color
            and piece.piece_type in {chess.KNIGHT, chess.BISHOP}
        )
        if undeveloped:
            names = [chess.square_name(square) for square in undeveloped]
            facts.append(
                _fact(
                    "undeveloped_minor_pieces",
                    "activity",
                    side,
                    f"{side.title()} still has {len(names)} undeveloped minor "
                    f"{'piece' if len(names) == 1 else 'pieces'} on {', '.join(names)}.",
                    squares=names,
                    pieces=[_piece_label(board.piece_at(square)) for square in undeveloped],
                    severity="weakness" if len(names) >= 3 else "info",
                    evidence={"count": len(names)},
                )
            )
        turn_board = _board_for_turn(board, color)
        legal_moves = list(turn_board.legal_moves)
        mobility[color] = len(legal_moves)
        captures = [move for move in legal_moves if turn_board.is_capture(move)]
        checks = [move for move in legal_moves if turn_board.gives_check(move)]
        if checks:
            squares = sorted({chess.square_name(move.from_square) for move in checks})
            facts.append(
                _fact(
                    "legal_checks",
                    "activity",
                    side,
                    f"{side.title()} has {len(checks)} legal checking "
                    f"{'move' if len(checks) == 1 else 'moves'}.",
                    squares=squares,
                    pieces=[_piece_label(board.piece_at(move.from_square)) for move in checks],
                    evidence={"moves": [move.uci() for move in checks]},
                )
            )
        if captures:
            squares = sorted(
                {chess.square_name(move.from_square) for move in captures}
                | {chess.square_name(move.to_square) for move in captures}
            )
            facts.append(
                _fact(
                    "legal_captures",
                    "activity",
                    side,
                    f"{side.title()} has {len(captures)} legal "
                    f"{'capture' if len(captures) == 1 else 'captures'}.",
                    squares=squares,
                    pieces=[],
                    evidence={"moves": [move.uci() for move in captures]},
                )
            )
    difference = mobility[chess.WHITE] - mobility[chess.BLACK]
    if abs(difference) >= 8:
        leader = chess.WHITE if difference > 0 else chess.BLACK
        facts.append(
            _fact(
                "mobility_advantage",
                "activity",
                _side(leader),
                f"{_side(leader).title()} has more legal options ({mobility[leader]} to "
                f"{mobility[not leader]}).",
                squares=[],
                pieces=[],
                severity="advantage",
                confidence="high",
                evidence={"whiteLegalMoves": mobility[chess.WHITE], "blackLegalMoves": mobility[chess.BLACK]},
            )
        )
    return facts


def _king_facts(board: chess.Board) -> list[dict]:
    facts = []
    for color in chess.COLORS:
        king = board.king(color)
        if king is None:
            continue
        starting_square = chess.E1 if color == chess.WHITE else chess.E8
        if king == starting_square and not board.has_castling_rights(color):
            name = chess.square_name(king)
            facts.append(
                _fact(
                    "uncastled_king_without_rights",
                    "king",
                    _side(color),
                    f"{_side(color).title()}'s king remains on {name} and can no longer castle.",
                    squares=[name],
                    pieces=[f"{_side(color)} king"],
                    severity="warning",
                )
            )
    if board.is_check():
        king = board.king(board.turn)
        if king is not None:
            attackers = sorted(board.attackers(not board.turn, king))
            facts.append(
                _fact(
                    "king_in_check",
                    "king",
                    _side(board.turn),
                    f"{_side(board.turn).title()}'s king is in check.",
                    squares=[chess.square_name(king)] + [chess.square_name(square) for square in attackers],
                    pieces=[f"{_side(board.turn)} king"]
                    + [_piece_label(board.piece_at(square)) for square in attackers],
                    severity="warning",
                )
            )
    return facts


def _tactical_facts(board: chess.Board) -> list[dict]:
    facts = []
    for color in chess.COLORS:
        side = _side(color)
        loose = []
        attacked_and_defended = []
        for square in sorted(chess.SquareSet(board.occupied_co[color])):
            piece = board.piece_at(square)
            if piece is None or piece.piece_type == chess.KING:
                continue
            defenders = board.attackers(color, square)
            attackers = board.attackers(not color, square)
            name = chess.square_name(square)
            if not defenders:
                loose.append(square)
            if attackers and defenders:
                attacked_and_defended.append(square)
            if board.is_pinned(color, square):
                facts.append(
                    _fact(
                        "pinned_piece",
                        "tactics",
                        side,
                        f"{side.title()}'s {chess.piece_name(piece.piece_type)} on {name} "
                        "is pinned to its king.",
                        squares=[name, chess.square_name(board.king(color))],
                        pieces=[_piece_label(piece), f"{side} king"],
                        severity="warning",
                    )
                )
            legal_enemy = _board_for_turn(board, not color)
            legal_captures = [
                move
                for move in legal_enemy.legal_moves
                if move.to_square == square and legal_enemy.is_capture(move)
            ]
            if legal_captures and not defenders:
                attacker_squares = sorted({move.from_square for move in legal_captures})
                facts.append(
                    _fact(
                        "hanging_piece",
                        "tactics",
                        side,
                        f"{side.title()}'s {chess.piece_name(piece.piece_type)} on {name} "
                        "is attacked and undefended.",
                        squares=[name] + [chess.square_name(item) for item in attacker_squares],
                        pieces=[_piece_label(piece)]
                        + [_piece_label(board.piece_at(item)) for item in attacker_squares],
                        severity="warning",
                        evidence={"legalCaptures": [move.uci() for move in legal_captures]},
                    )
                )
        if loose:
            names = [chess.square_name(square) for square in loose]
            facts.append(
                _fact(
                    "loose_pieces",
                    "tactics",
                    side,
                    f"{side.title()} has undefended pieces on {', '.join(names)}.",
                    squares=names,
                    pieces=[_piece_label(board.piece_at(square)) for square in loose],
                    severity="weakness",
                )
            )
        if attacked_and_defended:
            names = [chess.square_name(square) for square in attacked_and_defended]
            facts.append(
                _fact(
                    "attacked_and_defended_pieces",
                    "tactics",
                    side,
                    f"{side.title()} has attacked but defended pieces on {', '.join(names)}.",
                    squares=names,
                    pieces=[_piece_label(board.piece_at(square)) for square in attacked_and_defended],
                    evidence={"count": len(names)},
                )
            )
    if board.is_checkmate():
        winner = not board.turn
        king = board.king(board.turn)
        facts.append(
            _fact(
                "checkmate",
                "tactics",
                _side(winner),
                f"{_side(winner).title()} has delivered checkmate.",
                squares=[chess.square_name(king)] if king is not None else [],
                pieces=[f"{_side(board.turn)} king"] if king is not None else [],
                severity="warning",
            )
        )
    return facts


def extract_position_features(fen: str) -> dict:
    normalized = normalize_fen(fen)
    board = chess.Board(" ".join([*normalized.split()[:4], "0", "1"]))
    facts = [
        *_material_facts(board),
        *_pawn_facts(board),
        *_file_facts(board),
        *_activity_facts(board),
        *_king_facts(board),
        *_tactical_facts(board),
    ]
    facts.sort(key=lambda fact: (fact["category"], fact["side"], fact["kind"], fact["id"]))
    payload = {
        "fen": normalized,
        "schemaVersion": FEATURE_SCHEMA_VERSION,
        "extractorVersion": FEATURE_EXTRACTOR_VERSION,
        "facts": facts,
    }
    payload["checksum"] = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return payload


def compare_position_features(fen: str, move_uci: str) -> dict:
    """Return deterministic before/after facts for one legal move."""
    before = extract_position_features(fen)
    board = chess.Board(" ".join([*before["fen"].split()[:4], "0", "1"]))
    try:
        move = chess.Move.from_uci(move_uci)
    except ValueError as exc:
        raise ValueError("Move must be valid UCI.") from exc
    if move not in board.legal_moves:
        raise ValueError("Move is not legal in this position.")
    san = board.san(move)
    board.push(move)
    after = extract_position_features(board.fen())
    before_by_id = {fact["id"]: fact for fact in before["facts"]}
    after_by_id = {fact["id"]: fact for fact in after["facts"]}
    return {
        "originFen": before["fen"],
        "moveUci": move.uci(),
        "moveSan": san,
        "resultingFen": after["fen"],
        "before": before,
        "after": after,
        "addedFacts": [after_by_id[key] for key in sorted(after_by_id.keys() - before_by_id.keys())],
        "removedFacts": [before_by_id[key] for key in sorted(before_by_id.keys() - after_by_id.keys())],
    }
