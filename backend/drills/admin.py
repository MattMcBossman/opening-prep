from django.contrib import admin

from .models import DrillAttempt, DrillLineResult, DrillSession


class DrillLineResultInline(admin.TabularInline):
    model = DrillLineResult
    extra = 0


class DrillAttemptInline(admin.TabularInline):
    model = DrillAttempt
    extra = 0


@admin.register(DrillSession)
class DrillSessionAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "repertoire_id", "is_retry_pass", "started_at", "finished_at"]
    list_filter = ["is_retry_pass"]
    search_fields = ["user__username"]
    inlines = [DrillLineResultInline, DrillAttemptInline]
