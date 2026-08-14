from django.contrib.auth import get_user_model
from django.core.management import call_command

from repertoire.management.commands.seed_opening_templates import build_snapshot
from repertoire.models import OpeningTemplate, OpeningTemplateRelease, ProfileTemplateRelease
from repertoire.services import get_or_create_default_profile


def test_seed_opening_templates_is_legal_complete_and_idempotent(db):
    call_command("seed_opening_templates", verbosity=0)
    call_command("seed_opening_templates", verbosity=0)

    assert list(OpeningTemplate.objects.values_list("slug", flat=True)) == [
        "sicilian-defense",
        "stonewall-attack",
        "vienna-game",
    ]
    assert OpeningTemplateRelease.objects.count() == 3
    for release in OpeningTemplateRelease.objects.all():
        assert release.tree
        assert release.lines
        release.full_clean()


def test_seeded_vienna_is_attached_to_a_users_default_profile(db):
    call_command("seed_opening_templates", verbosity=0)
    user = get_user_model().objects.create_user(username="kurtis")

    profile = get_or_create_default_profile(user)
    get_or_create_default_profile(user)

    pin = ProfileTemplateRelease.objects.get(profile=profile)
    assert pin.release.template.slug == "vienna-game"
    assert pin.enabled is True


def test_authored_vienna_is_preferred_over_seed_fallback(db):
    call_command("seed_opening_templates", verbosity=0)
    tree, lines = build_snapshot("vienna", [["e2e4", "e7e5", "b1c3"]])
    template = OpeningTemplate.objects.create(
        slug="vienna", name="Vienna", color="white", is_published=True
    )
    authored = OpeningTemplateRelease.objects.create(
        template=template, version=1, tree=tree, lines=lines
    )
    user = get_user_model().objects.create_user(username="alpha-user")

    profile = get_or_create_default_profile(user)

    assert list(profile.template_links.values_list("release_id", flat=True)) == [authored.id]
