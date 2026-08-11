import chess
import responses

from repertoire.opening_generator import LichessPositionSource


@responses.activate
def test_lichess_source_sends_token_filters_and_parses_sorted_moves():
    responses.add(
        responses.GET,
        "https://explorer.example/lichess",
        json={
            "white": 60,
            "draws": 20,
            "black": 20,
            "moves": [
                {"uci": "d2d4", "san": "d4", "white": 10, "draws": 5, "black": 5},
                {"uci": "e2e4", "san": "e4", "white": 45, "draws": 10, "black": 5},
            ],
        },
    )
    source = LichessPositionSource(
        "https://explorer.example/lichess",
        "secret-token",
        ratings="1800,2000",
        speeds="rapid,classical",
    )

    result = source.lookup(chess.Board())

    assert result.total_games == 100
    assert [move.uci for move in result.moves] == ["e2e4", "d2d4"]
    request = responses.calls[0].request
    assert request.headers["Authorization"] == "Bearer secret-token"
    assert "ratings=1800%2C2000" in request.url
    assert "speeds=rapid%2Cclassical" in request.url
