import os
from copy import deepcopy

import environ
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction

from repertoire.models import OpeningTemplate, OpeningTemplateRelease, ProfileTemplateRelease
from repertoire.release_metadata import release_summary
from repertoire.validation import validate_release_snapshot


class Command(BaseCommand):
    help = "Copy selected local opening-template snapshots to another database."

    def add_arguments(self, parser):
        parser.add_argument("slugs", nargs="+")
        parser.add_argument("--target-url-env", default="RENDER_DATABASE_URL")
        parser.add_argument(
            "--replace-catalog",
            action="store_true",
            help="Remove all target template releases and profile pins before copying.",
        )

    def handle(self, *args, **options):
        slugs = list(dict.fromkeys(options["slugs"]))
        sources = list(OpeningTemplate.objects.filter(slug__in=slugs).prefetch_related("releases"))
        found = {template.slug for template in sources}
        missing = [slug for slug in slugs if slug not in found]
        if missing:
            raise CommandError(f"Local template snapshot not found: {', '.join(missing)}")

        snapshots = []
        for template in sources:
            release = template.releases.order_by("-version").first()
            if release is None:
                raise CommandError(f"Local template {template.slug} has no release.")
            validate_release_snapshot(release.tree, release.lines, template.color)
            snapshots.append(
                {
                    "slug": template.slug,
                    "name": template.name,
                    "description": template.description,
                    "color": template.color,
                    "tree": deepcopy(release.tree),
                    "lines": deepcopy(release.lines),
                }
            )

        env_name = options["target_url_env"]
        target_url = os.environ.get(env_name, "").strip()
        if not target_url:
            raise CommandError(f"{env_name} is not configured.")

        alias = "published_library_target"
        target = deepcopy(settings.DATABASES["default"])
        target.update(environ.Env.db_url_config(target_url))
        connections.databases[alias] = target

        try:
            with transaction.atomic(using=alias):
                if options["replace_catalog"]:
                    # Historical drills and personal copies may protect old
                    # releases. Retire them from the public catalog without
                    # destroying those references.
                    OpeningTemplate.objects.using(alias).update(is_published=False)
                    ProfileTemplateRelease.objects.using(alias).filter(
                        release__template__is_published=False
                    ).delete()

                for snapshot in snapshots:
                    template, _ = OpeningTemplate.objects.using(alias).get_or_create(
                        slug=snapshot["slug"],
                        defaults={
                            "name": snapshot["name"],
                            "description": snapshot["description"],
                            "color": snapshot["color"],
                            "kind": OpeningTemplate.OFFICIAL,
                            "is_published": True,
                        },
                    )
                    template.name = snapshot["name"]
                    template.description = snapshot["description"]
                    template.color = snapshot["color"]
                    template.kind = OpeningTemplate.OFFICIAL
                    template.publisher_id = None
                    template.source_module_id = None
                    template.is_published = True
                    template.save(using=alias)
                    latest = template.releases.using(alias).order_by("-version").first()
                    if latest and latest.tree == snapshot["tree"] and latest.lines == snapshot["lines"]:
                        self.stdout.write(
                            f"Kept {template.name} v{latest.version} ({len(snapshot['lines'])} lines)"
                        )
                        continue
                    version = (latest.version + 1) if latest else 1
                    common_start, line_count = release_summary(snapshot["lines"], snapshot["color"])
                    # The snapshot was validated above. bulk_create deliberately
                    # avoids the model's default-database immutability lookup.
                    OpeningTemplateRelease.objects.using(alias).bulk_create(
                        [
                            OpeningTemplateRelease(
                                template_id=template.pk,
                                version=version,
                                changelog="Initial Mainline alpha release.",
                                tree=snapshot["tree"],
                                lines=snapshot["lines"],
                                common_start=common_start,
                                line_count=line_count,
                            )
                        ]
                    )
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"Published {template.name} v{version} ({len(snapshot['lines'])} lines)"
                        )
                    )
        finally:
            connections[alias].close()
