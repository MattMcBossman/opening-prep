from django.contrib.auth import get_user_model
from django.core.management import call_command

from repertoire.management.commands.seed_opening_templates import build_snapshot
from repertoire.models import OpeningTemplate, OpeningTemplateRelease, ProfileTemplateRelease
from repertoire.services import get_or_create_default_profile


def test_seed_opening_templates_does_not_recreate_obsolete_starter_modules(db):
    call_command("seed_opening_templates", verbosity=0)
    call_command("seed_opening_templates", verbosity=0)

    assert not OpeningTemplate.objects.exists()
    assert not OpeningTemplateRelease.objects.exists()


def test_default_profile_has_no_persistent_library_attachment(db):
    call_command("seed_opening_templates", verbosity=0)
    user = get_user_model().objects.create_user(username="kurtis")

    profile = get_or_create_default_profile(user)
    get_or_create_default_profile(user)

    assert not ProfileTemplateRelease.objects.filter(profile=profile).exists()


def test_authored_vienna_is_not_persistently_attached(db):
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

    assert not profile.template_links.exists()
