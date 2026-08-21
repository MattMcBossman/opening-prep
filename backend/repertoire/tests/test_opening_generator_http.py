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


@responses.activate
def test_lichess_source_waits_for_retry_after_and_resumes_same_lookup():
    responses.add(
        responses.GET,
        "https://explorer.example/lichess",
        status=429,
        headers={"Retry-After": "2"},
    )
    responses.add(
        responses.GET,
        "https://explorer.example/lichess",
        json={"white": 10, "draws": 0, "black": 0, "moves": []},
    )
    countdown = []
    sleeps = []
    source = LichessPositionSource(
        "https://explorer.example/lichess",
        "secret-token",
        on_rate_limit=countdown.append,
        sleep=sleeps.append,
    )

    result = source.lookup(chess.Board())

    assert result.total_games == 10
    assert countdown == [2, 1, 0]
    assert sleeps == [1, 1]
    assert len(responses.calls) == 2


@responses.activate
def test_lichess_source_paces_consecutive_uncached_lookups(monkeypatch):
    responses.add(
        responses.GET,
        "https://explorer.example/lichess",
        json={"white": 10, "draws": 0, "black": 0, "moves": []},
    )
    responses.add(
        responses.GET,
        "https://explorer.example/lichess",
        json={"white": 8, "draws": 0, "black": 0, "moves": []},
    )
    clock = [100.0]

    def advance(seconds):
        clock[0] += seconds

    monkeypatch.setattr("repertoire.opening_generator.time.monotonic", lambda: clock[0])
    source = LichessPositionSource(
        "https://explorer.example/lichess",
        "secret-token",
        min_request_interval=1,
        sleep=advance,
    )

    source.lookup(chess.Board())
    next_board = chess.Board()
    next_board.push_uci("e2e4")
    source.lookup(next_board)

    assert clock[0] == 101.0
    assert len(responses.calls) == 2
