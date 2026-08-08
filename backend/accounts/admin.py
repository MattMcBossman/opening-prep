from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import LichessAccount, User

# The admin doubles as a dev-time inspector for repertoire trees and cached data
# (see AGENTS.md), so every model added in this phase should be registered.
admin.site.register(User, UserAdmin)


@admin.register(LichessAccount)
class LichessAccountAdmin(admin.ModelAdmin):
    """
    `encrypted_access_token` is deliberately absent from `fields` below (not
    merely `readonly_fields`, which would still render the ciphertext) - this
    admin page is for debugging OAuth linkage, not for looking at tokens.
    """

    list_display = ["lichess_username", "user", "token_expires_at", "updated_at"]
    fields = ["user", "lichess_id", "lichess_username", "token_expires_at"]
    readonly_fields = ["lichess_id"]
    search_fields = ["lichess_username", "user__username"]
