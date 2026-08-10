from django.core.management import call_command

from repertoire.models import OpeningTemplate, OpeningTemplateRelease


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
