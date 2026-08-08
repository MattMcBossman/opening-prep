from django.contrib import admin

from .models import EngineLineCache, PositionStatsCache


@admin.register(PositionStatsCache)
class PositionStatsCacheAdmin(admin.ModelAdmin):
    list_display = ["source", "fen", "params_key", "fetched_at", "expires_at"]
    list_filter = ["source"]
    search_fields = ["fen"]


@admin.register(EngineLineCache)
class EngineLineCacheAdmin(admin.ModelAdmin):
    list_display = ["fen", "depth", "score_type", "score_value", "best_move_uci", "updated_at"]
    search_fields = ["fen"]
