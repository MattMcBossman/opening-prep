import pytest
from rest_framework.test import APIClient

from explorer_cache.models import PositionFeatureSet
from explorer_cache.position_features import compare_position_features, extract_position_features

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
STRUCTURE_FEN = "4k3/8/7p/P7/P1PP4/8/8/2B1KB2 w - - 0 1"
TACTICAL_FEN = "k3r3/8/8/8/8/8/4R3/4K3 w - - 0 1"
HANGING_FEN = "4k3/8/8/4p3/3N4/8/8/4K3 w - - 0 1"
FILE_FEN = "4k3/3p4/8/8/8/8/8/R3K2R w - - 0 1"
MATE_FEN = "7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"


def kinds(payload, side=None):
    return {fact["kind"] for fact in payload["facts"] if side is None or fact["side"] == side}


def test_extracts_material_bishop_pair_and_pawn_evidence():
    payload = extract_position_features(STRUCTURE_FEN)
    white = [fact for fact in payload["facts"] if fact["side"] == "white"]

    assert {
        "material_advantage",
        "bishop_pair",
        "doubled_pawns",
        "isolated_pawn",
        "passed_pawn",
        "connected_pawns",
    } <= kinds(payload, "white")
    doubled = next(fact for fact in white if fact["kind"] == "doubled_pawns")
    assert doubled["squares"] == ["a4", "a5"]
    assert doubled["evidence"] == {"file": "a", "count": 2}
    connected = next(fact for fact in white if fact["kind"] == "connected_pawns")
    assert {"c4", "d4"} <= set(connected["squares"])
    assert len(payload["checksum"]) == 64


def test_starting_position_suppresses_absent_pawn_and_material_claims():
    payload = extract_position_features(START_FEN)
    assert "material_advantage" not in kinds(payload)
    assert "doubled_pawns" not in kinds(payload)
    assert "isolated_pawn" not in kinds(payload)
    assert "passed_pawn" not in kinds(payload)
    assert [fact["side"] for fact in payload["facts"] if fact["kind"] == "bishop_pair"] == ["black", "white"]
    assert "open_file" not in kinds(payload)
    assert "uncastled_king_without_rights" not in kinds(payload)
    assert "hanging_piece" not in kinds(payload)


def test_extracts_file_activity_king_and_tactical_evidence():
    file_payload = extract_position_features(FILE_FEN)
    assert "open_file" in kinds(file_payload, "white")
    assert "uncastled_king_without_rights" in kinds(file_payload, "white")

    pinned = extract_position_features(TACTICAL_FEN)
    pin = next(fact for fact in pinned["facts"] if fact["kind"] == "pinned_piece")
    assert {"e1", "e2"} <= set(pin["squares"])

    hanging = extract_position_features(HANGING_FEN)
    hanging_fact = next(fact for fact in hanging["facts"] if fact["kind"] == "hanging_piece")
    assert {"d4", "e5"} <= set(hanging_fact["squares"])

    mate = extract_position_features(MATE_FEN)
    assert "checkmate" in kinds(mate, "white")


def test_compares_added_and_removed_facts_for_a_legal_move():
    comparison = compare_position_features(START_FEN, "e2e4")
    assert comparison["moveSan"] == "e4"
    assert comparison["originFen"] == " ".join(START_FEN.split()[:4])
    assert comparison["resultingFen"].split()[1] == "b"
    assert comparison["addedFacts"] or comparison["removedFacts"]

    with pytest.raises(ValueError, match="not legal"):
        compare_position_features(START_FEN, "e2e5")


@pytest.mark.django_db
def test_public_feature_endpoint_normalizes_and_reuses_cached_facts():
    client = APIClient()
    first = client.get("/api/v1/explorer/position-features/", {"fen": STRUCTURE_FEN})
    assert first.status_code == 200
    assert first.data["schemaVersion"] == 1
    assert first.data["extractorVersion"] == "concrete-v2"
    assert "doubled_pawns" in {fact["kind"] for fact in first.data["facts"]}

    normalized = " ".join(STRUCTURE_FEN.split()[:4])
    second = client.get("/api/v1/explorer/position-features/", {"fen": normalized})
    assert second.status_code == 200
    assert second.data["checksum"] == first.data["checksum"]
    assert PositionFeatureSet.objects.count() == 1


@pytest.mark.django_db
def test_feature_endpoint_rejects_invalid_fen_without_caching():
    response = APIClient().get("/api/v1/explorer/position-features/", {"fen": "not-a-fen"})
    assert response.status_code == 400
    assert PositionFeatureSet.objects.count() == 0


@pytest.mark.django_db
def test_public_move_comparison_endpoint_validates_legality():
    client = APIClient()
    response = client.get("/api/v1/explorer/move-comparisons/", {"fen": START_FEN, "move": "e2e4"})
    assert response.status_code == 200
    assert response.data["moveSan"] == "e4"
    assert response.data["after"]["extractorVersion"] == "concrete-v2"

    illegal = client.get("/api/v1/explorer/move-comparisons/", {"fen": START_FEN, "move": "e2e5"})
    assert illegal.status_code == 400
