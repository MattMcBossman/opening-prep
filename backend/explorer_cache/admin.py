from django.contrib import admin

from .models import (
    ChessComArchiveCache,
    ChessComGamePosition,
    EngineLineCache,
    PlayerStatsCache,
    PositionAnalysis,
    PositionFeatureSet,
    PositionStatsCache,
)


@admin.register(ChessComArchiveCache)
class ChessComArchiveCacheAdmin(admin.ModelAdmin):
    list_display = ["username", "archive_key", "fetched_at", "expires_at", "indexed_at"]
    search_fields = ["username", "archive_key"]


@admin.register(ChessComGamePosition)
class ChessComGamePositionAdmin(admin.ModelAdmin):
    list_display = ["username", "archive_key", "player_color", "origin_fen", "san", "played_at"]
    list_filter = ["player_color", "time_class"]
    search_fields = ["username", "origin_fen", "game_key"]


@admin.register(PositionStatsCache)
class PositionStatsCacheAdmin(admin.ModelAdmin):
    list_display = ["source", "fen", "params_key", "fetched_at", "expires_at"]
    list_filter = ["source"]
    search_fields = ["fen"]


@admin.register(EngineLineCache)
class EngineLineCacheAdmin(admin.ModelAdmin):
    list_display = [
        "engine_version",
        "fen",
        "depth",
        "score_type",
        "score_value",
        "best_move_uci",
        "updated_at",
    ]
    search_fields = ["fen"]


@admin.register(PositionAnalysis)
class PositionAnalysisAdmin(admin.ModelAdmin):
    list_display = ["engine_version", "analysis_profile", "fen", "depth", "multi_pv", "updated_at"]
    list_filter = ["engine_version", "analysis_profile"]
    search_fields = ["fen"]


@admin.register(PositionFeatureSet)
class PositionFeatureSetAdmin(admin.ModelAdmin):
    list_display = ["extractor_version", "schema_version", "fen", "updated_at"]
    list_filter = ["extractor_version", "schema_version"]
    search_fields = ["fen"]


@admin.register(PlayerStatsCache)
class PlayerStatsCacheAdmin(admin.ModelAdmin):
    list_display = ["user", "color", "fen", "params_key", "fetched_at", "expires_at"]
    list_filter = ["color"]
    search_fields = ["user__username", "fen"]
