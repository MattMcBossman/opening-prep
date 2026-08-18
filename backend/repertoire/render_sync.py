"""One-way snapshots from the authoritative Render database into local Mainline."""

from copy import deepcopy
import re

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from .models import (
    OpeningTemplate,
    OpeningTemplateRelease,
    ProfileModule,
    Repertoire,
    RepertoireLine,
    RepertoireLineStep,
    RepertoireMove,
    RepertoireProfile,
)
from .validation import validate_release_snapshot


def _account_for_identifier(*, using: str, identifier: str):
    """Resolve UI-style account names across Google-generated punctuation/case."""
    users = get_user_model().objects.using(using)
    exact = users.filter(username__iexact=identifier).first()
    if exact:
        return exact
    normalized = re.sub(r"[^a-z0-9]", "", identifier.lower())
    matches = [
        user
        for user in users.all().only("id", "username")
        if re.sub(r"[^a-z0-9]", "", user.username.lower()) == normalized
    ]
    if len(matches) == 1:
        return matches[0]
    raise get_user_model().DoesNotExist(identifier)


def capture_sync_snapshot(*, using: str, username: str) -> dict:
    """Read and validate all repertoire-domain data needed for a safe mirror."""
    user = _account_for_identifier(using=using, identifier=username)
    modules = []
    for module in Repertoire.objects.using(using).filter(owner=user).order_by("id"):
        moves = list(module.moves.using(using).order_by("id"))
        move_keys = {move.id: f"{move.origin_fen}\n{move.uci}" for move in moves}
        lines = []
        for line in module.lines.using(using).prefetch_related("steps__move").order_by("sort_order", "id"):
            lines.append(
                {
                    "line_key": line.line_key,
                    "uci_path": line.uci_path,
                    "label": line.label,
                    "annotations": deepcopy(line.annotations),
                    "source": line.source,
                    "sort_order": line.sort_order,
                    "steps": [move_keys[step.move_id] for step in line.steps.all()],
                }
            )
        modules.append(
            {
                "source_id": module.id,
                "name": module.name,
                "description": module.description,
                "color": module.color,
                "source_release": (
                    [module.source_release.template.slug, module.source_release.version]
                    if module.source_release_id
                    else None
                ),
                "moves": [
                    {
                        "key": move_keys[move.id],
                        "origin_fen": move.origin_fen,
                        "san": move.san,
                        "uci": move.uci,
                        "resulting_fen": move.resulting_fen,
                        "sort_order": move.sort_order,
                    }
                    for move in moves
                ],
                "lines": lines,
            }
        )

    profiles = []
    for profile in RepertoireProfile.objects.using(using).filter(owner=user).order_by("id"):
        profiles.append(
            {
                "name": profile.name,
                "description": profile.description,
                "modules": [
                    {"source_id": link.module_id, "sort_order": link.sort_order, "enabled": link.enabled}
                    for link in profile.module_links.using(using).order_by("sort_order", "id")
                ],
            }
        )

    templates = []
    # Include the public catalog plus retired releases still referenced by this
    # account, otherwise a copied module or profile pin could not be restored.
    queryset = (
        OpeningTemplate.objects.using(using)
        .filter(
            Q(is_published=True)
            | Q(releases__copies__owner=user)
            | Q(releases__profile_links__profile__owner=user)
        )
        .distinct()
        .prefetch_related("releases")
    )
    for template in queryset.order_by("slug"):
        releases = []
        for release in template.releases.all().order_by("version"):
            validate_release_snapshot(release.tree, release.lines, template.color)
            releases.append(
                {
                    "version": release.version,
                    "changelog": release.changelog,
                    "tree": deepcopy(release.tree),
                    "lines": deepcopy(release.lines),
                    "common_start": release.common_start,
                    "line_count": release.line_count,
                }
            )
        templates.append(
            {
                "slug": template.slug,
                "kind": template.kind,
                "publisher_is_synced_user": template.publisher_id == user.id,
                "source_module_id": template.source_module_id,
                "name": template.name,
                "description": template.description,
                "color": template.color,
                "is_published": template.is_published,
                "releases": releases,
            }
        )
    return {"username": user.username, "modules": modules, "profiles": profiles, "templates": templates}


def apply_sync_snapshot(*, snapshot: dict, using: str, target_username: str) -> dict:
    """Atomically replace one target account and mirror the published catalog."""
    user = _account_for_identifier(using=using, identifier=target_username)
    with transaction.atomic(using=using):
        # Remove the target account first so its old pins cannot protect stale
        # local releases. The enclosing transaction restores it all on error.
        RepertoireProfile.objects.using(using).filter(owner=user).delete()
        Repertoire.objects.using(using).filter(owner=user).delete()
        source_slugs = {item["slug"] for item in snapshot["templates"] if item["is_published"]}
        OpeningTemplate.objects.using(using).filter(is_published=True).exclude(slug__in=source_slugs).update(
            is_published=False
        )
        templates = {}
        for item in snapshot["templates"]:
            template, _ = OpeningTemplate.objects.using(using).get_or_create(slug=item["slug"])
            template.kind = item["kind"]
            template.publisher_id = user.id if item["publisher_is_synced_user"] else None
            template.source_module_id = None
            template.name = item["name"]
            template.description = item["description"]
            template.color = item["color"]
            template.is_published = item["is_published"]
            template.save(using=using)
            templates[item["slug"]] = template
            source_versions = {release["version"] for release in item["releases"]}
            stale_releases = template.releases.using(using).exclude(version__in=source_versions)
            if stale_releases.filter(copies__isnull=False).exists():
                raise ValidationError(
                    f"A different local account copied a stale {template.slug} release; "
                    "refusing to alter its provenance."
                )
            stale_releases.delete()
            for release_data in item["releases"]:
                existing = OpeningTemplateRelease.objects.using(using).filter(
                    template=template, version=release_data["version"]
                ).first()
                if existing:
                    comparable = (existing.tree, existing.lines, existing.changelog)
                    expected = (release_data["tree"], release_data["lines"], release_data["changelog"])
                    if comparable != expected:
                        # Render is authoritative. Update the target row in
                        # place so local profile pins and copied-module
                        # provenance keep pointing at the mirrored release.
                        OpeningTemplateRelease.objects.using(using).filter(pk=existing.pk).update(
                            changelog=release_data["changelog"],
                            tree=release_data["tree"],
                            lines=release_data["lines"],
                            common_start=release_data["common_start"],
                            line_count=release_data["line_count"],
                        )
                    continue
                OpeningTemplateRelease.objects.using(using).bulk_create(
                    [
                        OpeningTemplateRelease(
                            template=template,
                            version=release_data["version"],
                            changelog=release_data["changelog"],
                            tree=release_data["tree"],
                            lines=release_data["lines"],
                            common_start=release_data["common_start"],
                            line_count=release_data["line_count"],
                        )
                    ]
                )

        module_map = {}
        for item in snapshot["modules"]:
            source_release = None
            if item["source_release"]:
                slug, version = item["source_release"]
                source_release = OpeningTemplateRelease.objects.using(using).get(
                    template__slug=slug, version=version
                )
            module = Repertoire.objects.using(using).create(
                owner=user,
                name=item["name"],
                description=item["description"],
                color=item["color"],
                source_release=source_release,
            )
            module_map[item["source_id"]] = module
            moves = RepertoireMove.objects.using(using).bulk_create(
                [RepertoireMove(repertoire=module, **{k: v for k, v in move.items() if k != "key"}) for move in item["moves"]]
            )
            move_map = {f"{move.origin_fen}\n{move.uci}": move for move in moves}
            for line_data in item["lines"]:
                steps = line_data["steps"]
                line = RepertoireLine.objects.using(using).create(
                    repertoire=module,
                    **{k: v for k, v in line_data.items() if k != "steps"},
                )
                RepertoireLineStep.objects.using(using).bulk_create(
                    [RepertoireLineStep(line=line, ply=ply, move=move_map[key]) for ply, key in enumerate(steps)]
                )

        for item in snapshot["profiles"]:
            profile = RepertoireProfile.objects.using(using).create(
                owner=user, name=item["name"], description=item["description"]
            )
            ProfileModule.objects.using(using).bulk_create(
                [
                    ProfileModule(
                        profile=profile,
                        module=module_map[link["source_id"]],
                        sort_order=link["sort_order"],
                        enabled=link["enabled"],
                    )
                    for link in item["modules"]
                ]
            )

        for item in snapshot["templates"]:
            if item["source_module_id"] in module_map:
                OpeningTemplate.objects.using(using).filter(pk=templates[item["slug"]].pk).update(
                    source_module=module_map[item["source_module_id"]]
                )
    return {
        "modules": len(snapshot["modules"]),
        "profiles": len(snapshot["profiles"]),
        "templates": len(snapshot["templates"]),
    }
