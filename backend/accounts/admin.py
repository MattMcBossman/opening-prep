from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User

# The admin doubles as a dev-time inspector for repertoire trees and cached data
# (see AGENTS.md), so every model added in this phase should be registered.
admin.site.register(User, UserAdmin)
