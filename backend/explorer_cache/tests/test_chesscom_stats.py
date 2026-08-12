import responses

from accounts.models import ChessComAccount, User
from explorer_cache import chesscom_stats

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


@responses.activate
def test_builds_position_stats_from_cached_monthly_pgns(db, settings):
    user = User.objects.create_user(username="mainline-user")
    ChessComAccount.objects.create(user=user, username="ExamplePlayer")
    base = settings.CHESS_COM_API_URL.rstrip("/")
    archive_url = f"{base}/player/exampleplayer/games/2026/08"
    responses.add(
        responses.GET,
        f"{base}/player/ExamplePlayer/games/archives",
        json={"archives": [archive_url]},
    )
    responses.add(
        responses.GET,
        archive_url,
        json={
            "games": [
                {
                    "rules": "chess",
                    "time_class": "rapid",
                    "end_time": 1786500000,
                    "white": {"username": "ExamplePlayer"},
                    "black": {"username": "Opponent"},
                    "pgn": '[White "ExamplePlayer"]\n[Black "Opponent"]\n[Result "1-0"]\n\n1. e4 e5 1-0',
                }
            ]
        },
    )

    result = chesscom_stats.fetch_chesscom_stats(
        user, START_FEN, 12, "white", since="2026-08", until="2026-08", speeds="rapid"
    )

    assert result["totalGames"] == 1
    assert result["moves"] == [
        {"san": "e4", "uci": "e2e4", "white": 1, "draws": 0, "black": 0, "totalGames": 1}
    ]

    chesscom_stats.fetch_chesscom_stats(
        user, START_FEN, 12, "white", since="2026-08", until="2026-08", speeds="rapid"
    )
    assert len(responses.calls) == 2
