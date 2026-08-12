from django.contrib import admin

from .models import (
    OpeningTemplate,
    OpeningTemplateRelease,
    ProfileModule,
    ProfileTemplateRelease,
    Repertoire,
    RepertoireLine,
    RepertoireLineStep,
    RepertoireMove,
    RepertoireProfile,
)


class RepertoireMoveInline(admin.TabularInline):
    model = RepertoireMove
    extra = 0


class ProfileModuleInline(admin.TabularInline):
    model = ProfileModule
    extra = 0


class RepertoireLineStepInline(admin.TabularInline):
    model = RepertoireLineStep
    extra = 0


@admin.register(RepertoireProfile)
class RepertoireProfileAdmin(admin.ModelAdmin):
    list_display = ["owner", "name", "created_at", "updated_at"]
    search_fields = ["owner__username", "name"]
    inlines = [ProfileModuleInline]


@admin.register(Repertoire)
class RepertoireAdmin(admin.ModelAdmin):
    """Doubles as the dev-time repertoire-tree inspector called for in AGENTS.md."""

    list_display = ["owner", "name", "color", "description", "created_at", "updated_at"]
    list_filter = ["color"]
    search_fields = ["owner__username", "name"]
    inlines = [RepertoireMoveInline]


@admin.register(RepertoireMove)
class RepertoireMoveAdmin(admin.ModelAdmin):
    list_display = ["repertoire", "origin_fen", "san", "uci", "resulting_fen", "sort_order"]
    search_fields = ["origin_fen", "resulting_fen", "uci"]


@admin.register(RepertoireLine)
class RepertoireLineAdmin(admin.ModelAdmin):
    list_display = ["repertoire", "uci_path", "source", "sort_order", "updated_at"]
    list_filter = ["source", "repertoire__color"]
    search_fields = ["uci_path", "label", "repertoire__name"]
    inlines = [RepertoireLineStepInline]


class OpeningTemplateReleaseInline(admin.TabularInline):
    model = OpeningTemplateRelease
    extra = 0
    readonly_fields = ["published_at"]


@admin.register(OpeningTemplate)
class OpeningTemplateAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "kind", "publisher", "color", "is_published"]
    list_filter = ["kind", "color", "is_published"]
    prepopulated_fields = {"slug": ("name",)}
    inlines = [OpeningTemplateReleaseInline]


@admin.register(OpeningTemplateRelease)
class OpeningTemplateReleaseAdmin(admin.ModelAdmin):
    list_display = ["template", "version", "published_at"]

    def get_readonly_fields(self, request, obj=None):
        if obj is None:
            return ["published_at"]
        return ["template", "version", "changelog", "tree", "lines", "published_at"]


admin.site.register(ProfileTemplateRelease)
