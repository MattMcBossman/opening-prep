import os
from copy import deepcopy
from pathlib import Path

import environ
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import connections

from repertoire.render_sync import apply_sync_snapshot, capture_sync_snapshot


class Command(BaseCommand):
    help = "Mirror one Render account and the published opening catalog into this database."

    def add_arguments(self, parser):
        parser.add_argument("--source-username", default="matt.mcclelland")
        parser.add_argument("--target-username", default="matt.mcclelland")
        parser.add_argument("--source-url-env", default="MAINLINE_RENDER_DATABASE_URL")
        parser.add_argument(
            "--config-file",
            help="Environment file to load (defaults to ~/.config/mainline/render-sync.env).",
        )
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument(
            "--allow-empty-account",
            action="store_true",
            help="Allow an empty Render account to erase the target account's repertoire data.",
        )

    def handle(self, *args, **options):
        env_name = options["source_url_env"]
        config_file = options["config_file"]
        if config_file is None:
            config_home = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
            config_path = config_home / "mainline" / "render-sync.env"
        else:
            config_path = Path(config_file).expanduser()
        if not os.environ.get(env_name) and config_path.is_file():
            environ.Env.read_env(config_path, overwrite=False)
        source_url = os.environ.get(env_name, "").strip()
        if not source_url:
            raise CommandError(
                f"{env_name} is not configured in the environment or {config_path}."
            )
        alias = "render_sync_source"
        database = deepcopy(settings.DATABASES["default"])
        database.update(environ.Env.db_url_config(source_url))
        connections.databases[alias] = database
        try:
            identity_fields = ("ENGINE", "HOST", "PORT", "NAME", "USER")
            source_identity = tuple(str(database.get(field, "")) for field in identity_fields)
            target_identity = tuple(
                str(settings.DATABASES["default"].get(field, "")) for field in identity_fields
            )
            if source_identity == target_identity:
                raise CommandError("The Render source and local target resolve to the same database.")
            snapshot = capture_sync_snapshot(using=alias, username=options["source_username"])
            if not options["allow_empty_account"] and not (
                snapshot["profiles"] or snapshot["modules"]
            ):
                raise CommandError(
                    "The Render account has no profiles or modules; refusing to erase the local account. "
                    "Pass --allow-empty-account if that is intentional."
                )
            if options["dry_run"]:
                self.stdout.write(
                    f"Would sync {len(snapshot['profiles'])} profiles, {len(snapshot['modules'])} modules, "
                    f"and {len(snapshot['templates'])} published templates."
                )
                return
            counts = apply_sync_snapshot(
                snapshot=snapshot, using="default", target_username=options["target_username"]
            )
            self.stdout.write(
                self.style.SUCCESS(
                    f"Synced {counts['profiles']} profiles, {counts['modules']} modules, and "
                    f"{counts['templates']} published templates from Render."
                )
            )
        except get_user_model().DoesNotExist as exc:
            raise CommandError("The configured source or target username does not exist.") from exc
        finally:
            connections[alias].close()
