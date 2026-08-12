from django.contrib import admin

from .models import (
    EngineLineCache,
    MainlineOpeningName,
    PositionAnalysis,
    PositionFeatureSet,
    PositionStatsCache,
)


@admin.register(MainlineOpeningName)
class MainlineOpeningNameAdmin(admin.ModelAdmin):
    list_display = ["name", "eco", "fen", "updated_at"]
    search_fields = ["name", "eco", "fen"]
    readonly_fields = ["updated_at"]


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
