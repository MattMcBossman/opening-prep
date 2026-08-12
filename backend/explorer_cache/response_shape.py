"""
Shared transform from a raw Lichess opening-explorer payload (the `/lichess`
position database or the `/player` player-scoped database - both share the
same top-level `white`/`draws`/`black`/`moves`/`opening` shape) into
`ExplorerResponse` (`frontend/src/types.ts`).

Split out of `cache.py` so `player_stats.py`'s live (uncached) player-scoped
proxy can reuse it without importing the DB-caching module for something that
has nothing to do with caching.
"""


def to_explorer_response(raw: dict) -> dict:
    """Mirrors the transform `fetchLichessExplorer` does client-side (`lichessExplorer.ts`)."""
    moves = []
    for m in raw.get("moves") or []:
        white = m.get("white") or 0
        draws = m.get("draws") or 0
        black = m.get("black") or 0
        move = {
            "san": m.get("san"),
            "uci": m.get("uci"),
            "white": white,
            "draws": draws,
            "black": black,
            "totalGames": white + draws + black,
        }
        if m.get("opening"):
            move["opening"] = {"eco": m["opening"]["eco"], "name": m["opening"]["name"]}
        moves.append(move)
    opening = raw.get("opening")
    return {
        "totalGames": (raw.get("white") or 0) + (raw.get("draws") or 0) + (raw.get("black") or 0),
        "moves": moves,
        "opening": {"eco": opening["eco"], "name": opening["name"]} if opening else None,
    }
