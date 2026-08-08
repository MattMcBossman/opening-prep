from django.contrib import admin

from .models import Repertoire, RepertoireMove


class RepertoireMoveInline(admin.TabularInline):
    model = RepertoireMove
    extra = 0


@admin.register(Repertoire)
class RepertoireAdmin(admin.ModelAdmin):
    """Doubles as the dev-time repertoire-tree inspector called for in AGENTS.md."""

    list_display = ["owner", "name", "color", "created_at", "updated_at"]
    list_filter = ["color"]
    search_fields = ["owner__username", "name"]
    inlines = [RepertoireMoveInline]


@admin.register(RepertoireMove)
class RepertoireMoveAdmin(admin.ModelAdmin):
    list_display = ["repertoire", "origin_fen", "san", "uci", "resulting_fen"]
    search_fields = ["origin_fen", "resulting_fen", "uci"]
