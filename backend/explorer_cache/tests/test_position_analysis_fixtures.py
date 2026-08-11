import json
from pathlib import Path

import chess
import pytest

from explorer_cache.serializers import PositionAnalysisUploadSerializer, derive_recurring_moves

FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "position_analysis_cases.json").read_text())


@pytest.mark.parametrize("case", FIXTURES, ids=lambda case: case["name"])
def test_analysis_fixture_replays_and_documents_only_expected_evidence(case):
    serializer = PositionAnalysisUploadSerializer(
        data={
            "fen": case["fen"],
            "engineVersion": "stockfish-18-lite-single",
            "analysisProfile": "drill-review-basic-v1",
            "candidates": case["candidates"],
        }
    )
    assert serializer.is_valid(), serializer.errors

    recurring = derive_recurring_moves(case["fen"], serializer.validated_data["candidates"])
    assert sorted(move["uci"] for move in recurring) == sorted(case["expected"].get("recurring", []))
    if expected_first := case["expected"].get("firstMove"):
        assert serializer.validated_data["candidates"][0]["bestMoveUci"] == expected_first

    if "sameResultingFen" in case["expected"]:
        resulting = []
        for candidate in serializer.validated_data["candidates"]:
            board = chess.Board(case["fen"])
            for uci in candidate["pvUci"]:
                board.push_uci(uci)
            resulting.append(" ".join(board.fen(en_passant="legal").split()[:4]))
        assert len(set(resulting)) == 1


def test_fixture_claims_are_explicitly_non_authoritative():
    unsupported = [claim for case in FIXTURES for claim in case["expected"]["unsupportedClaims"]]
    assert "White has a lasting initiative" in unsupported
    assert "The passed pawn is a lasting strength" in unsupported
