from explorer_cache.response_shape import to_explorer_response


def test_preserves_opening_metadata_attached_to_candidate_moves():
    result = to_explorer_response(
        {
            "white": 10,
            "draws": 2,
            "black": 8,
            "opening": None,
            "moves": [
                {
                    "san": "e4",
                    "uci": "e2e4",
                    "white": 6,
                    "draws": 1,
                    "black": 3,
                    "opening": {"eco": "B00", "name": "King's Pawn Game"},
                }
            ],
        }
    )

    assert result["opening"] is None
    assert result["moves"][0]["opening"] == {"eco": "B00", "name": "King's Pawn Game"}
