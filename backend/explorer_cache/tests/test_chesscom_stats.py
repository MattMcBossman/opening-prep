import responses
from django.utils import timezone

from accounts.models import ChessComAccount, User
from explorer_cache import chesscom_stats
from explorer_cache.models import ChessComArchiveCache, ChessComGamePosition, PlayerStatsCache

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


@responses.activate
def test_returns_partial_results_while_incrementally_indexing_archives(db, settings, monkeypatch):
    user = User.objects.create_user(username="mainline-user")
    ChessComAccount.objects.create(user=user, username="ExamplePlayer")
    base = settings.CHESS_COM_API_URL.rstrip("/")
    archive_urls = [
        f"{base}/player/exampleplayer/games/2026/07",
        f"{base}/player/exampleplayer/games/2026/08",
    ]
    responses.add(
        responses.GET,
        f"{base}/player/ExamplePlayer/games/archives",
        json={"archives": archive_urls},
    )
    for archive_url, move in zip(archive_urls, ("d4 d5", "e4 e5"), strict=True):
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
                        "pgn": (
                            '[White "ExamplePlayer"]\n[Black "Opponent"]\n'
                            f'[Result "1-0"]\n\n1. {move} 1-0'
                        ),
                    }
                ]
            },
        )
    monkeypatch.setattr(chesscom_stats, "INDEX_BUDGET_SECONDS", -1)

    partial = chesscom_stats.fetch_chesscom_stats(user, START_FEN, 12, "white")
    complete = chesscom_stats.fetch_chesscom_stats(user, START_FEN, 12, "white")

    assert partial["stillIndexing"] is True
    assert partial["totalGames"] == 1
    assert complete.get("stillIndexing") is None
    assert complete["totalGames"] == 2
    assert ChessComGamePosition.objects.count() == 4


@responses.activate
def test_refreshes_and_reindexes_an_expired_archive(db, settings):
    user = User.objects.create_user(username="mainline-user")
    ChessComAccount.objects.create(user=user, username="ExamplePlayer")
    base = settings.CHESS_COM_API_URL.rstrip("/")
    archive_url = f"{base}/player/exampleplayer/games/2026/08"
    responses.add(
        responses.GET,
        f"{base}/player/ExamplePlayer/games/archives",
        json={"archives": [archive_url]},
    )
    first_payload = {
        "games": [
            {
                "rules": "chess",
                "time_class": "rapid",
                "end_time": 1786500000,
                "white": {"username": "ExamplePlayer"},
                "black": {"username": "Opponent"},
                "pgn": '[Result "1-0"]\n\n1. e4 e5 1-0',
            }
        ]
    }
    responses.add(responses.GET, archive_url, json=first_payload)
    chesscom_stats.fetch_chesscom_stats(user, START_FEN, 12, "white")
    archive = ChessComArchiveCache.objects.get(archive_key="2026-08")
    archive.expires_at = timezone.now()
    archive.save(update_fields=["expires_at"])
    PlayerStatsCache.objects.update(expires_at=timezone.now())
    responses.add(
        responses.GET,
        archive_url,
        json={"games": [{**first_payload["games"][0], "pgn": '[Result "1-0"]\n\n1. d4 d5 1-0'}]},
    )

    refreshed = chesscom_stats.fetch_chesscom_stats(user, START_FEN, 12, "white")

    assert refreshed["moves"][0]["uci"] == "d2d4"
    assert ChessComGamePosition.objects.filter(uci="e2e4").count() == 0
