from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import ChessComAccount, EmailIdentity, GoogleAccount, LichessAccount, MagicLink, User

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


@admin.register(ChessComAccount)
class ChessComAccountAdmin(admin.ModelAdmin):
    list_display = ["username", "user", "updated_at"]


@admin.register(EmailIdentity)
class EmailIdentityAdmin(admin.ModelAdmin):
    list_display = ["email", "user", "created_at"]
    search_fields = ["email", "user__username"]


@admin.register(GoogleAccount)
class GoogleAccountAdmin(admin.ModelAdmin):
    list_display = ["email", "user", "updated_at"]
    search_fields = ["email", "user__username"]


@admin.register(MagicLink)
class MagicLinkAdmin(admin.ModelAdmin):
    list_display = ["email", "created_at", "expires_at", "used_at"]
    exclude = ["token_hash"]
    search_fields = ["username", "user__username"]
