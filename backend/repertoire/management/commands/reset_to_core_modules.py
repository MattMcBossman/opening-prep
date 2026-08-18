from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Count

from drills.models import DrillSessionTemplateRelease
from repertoire import services
from repertoire.models import (
    OpeningTemplate,
    OpeningTemplateRelease,
    ProfileModule,
    ProfileTemplateRelease,
    Repertoire,
    RepertoireProfile,
)
from repertoire.render_sync import _account_for_identifier
from repertoire.serializers import RepertoireLineSerializer


CONFIRMATION = "DELETE ALL OTHER MODULES"
CORE_MODULES = (("caro", "caro-kann", 46), ("vienna", "vienna", 99))


class Command(BaseCommand):
    help = "Destructively retain only the 46-line Caro-Kann and 99-line Vienna modules."

    def add_arguments(self, parser):
        parser.add_argument("--username", default="matt.mcclelland")
        parser.add_argument("--confirm", required=True)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        if options["confirm"] != CONFIRMATION:
            raise CommandError(f'Pass --confirm "{CONFIRMATION}" to authorize the reset.')
        user = _account_for_identifier(using="default", identifier=options["username"])
        selected = []
        for name_fragment, slug, line_count in CORE_MODULES:
            matches = list(
                Repertoire.objects.filter(owner=user, name__icontains=name_fragment)
                .annotate(actual_line_count=Count("lines"))
                .filter(actual_line_count=line_count)
            )
            if len(matches) != 1:
                choices = ", ".join(
                    f"{module.name} ({module.actual_line_count} lines)" for module in matches
                ) or "none"
                inventory = ", ".join(
                    f"{module.name}: {module.actual_line_count} lines"
                    for module in Repertoire.objects.filter(owner=user)
                    .annotate(actual_line_count=Count("lines"))
                    .order_by("name", "id")
                )
                raise CommandError(
                    f"Expected exactly one saved {line_count}-line {name_fragment} module; "
                    f"found {choices}. Saved inventory: {inventory or 'empty'}."
                )
            module = matches[0]
            selected.append(
                {
                    "slug": slug,
                    "name": module.name,
                    "description": module.description,
                    "color": module.color,
                    "tree": services.serialize_tree(module),
                    "lines": list(
                        RepertoireLineSerializer(
                            module.lines.prefetch_related("steps__move"), many=True
                        ).data
                    ),
                    "line_count": line_count,
                }
            )

        if options["dry_run"]:
            self.stdout.write(
                "Would retain only: "
                + ", ".join(
                    f"{item['name']} ({item['line_count']} lines)" for item in selected
                )
            )
            return

        with transaction.atomic():
            # Persistent library attachments are intentionally retired. A
            # library release may only be previewed transiently or copied into
            # an editable personal module.
            ProfileTemplateRelease.objects.all().delete()
            DrillSessionTemplateRelease.objects.all().delete()

            # Delete all personal modules in this environment, including other
            # users' scratch modules, as explicitly requested for this reset.
            Repertoire.objects.all().delete()
            RepertoireProfile.objects.filter(owner=user).delete()

            OpeningTemplate.objects.all().delete()

            profile = RepertoireProfile.objects.create(owner=user, name="Default")
            created = []
            for sort_order, item in enumerate(selected):
                template = OpeningTemplate.objects.create(
                    slug=item["slug"],
                    kind=OpeningTemplate.OFFICIAL,
                    publisher=user,
                    name=item["name"],
                    description=item["description"],
                    color=item["color"],
                    is_published=True,
                )
                release = OpeningTemplateRelease.objects.create(
                    template=template,
                    version=1,
                    changelog="Authoritative Mainline module.",
                    tree=item["tree"],
                    lines=item["lines"],
                )
                module = Repertoire.objects.create(
                    owner=user,
                    name=item["name"],
                    description=item["description"],
                    color=item["color"],
                    source_release=release,
                )
                services.import_release_lines(module, release)
                if module.lines.count() != release.line_count:
                    raise CommandError(
                        f"Copying {release.template.name} produced {module.lines.count()} lines, "
                        f"expected {release.line_count}."
                    )
                ProfileModule.objects.create(
                    profile=profile, module=module, sort_order=sort_order, enabled=True
                )
                OpeningTemplate.objects.filter(pk=template.pk).update(source_module=module)
                created.append(f"{item['name']} ({release.line_count} lines)")

        self.stdout.write(self.style.SUCCESS("Retained only: " + ", ".join(created)))
