import pytest

from accounts.models import User
from repertoire.models import (
    OpeningTemplate,
    OpeningTemplateRelease,
    ProfileModule,
    Repertoire,
    RepertoireLine,
    RepertoireLineStep,
    RepertoireMove,
    RepertoireProfile,
)
from repertoire.management.commands.seed_opening_templates import build_snapshot
from repertoire.render_sync import apply_sync_snapshot, capture_sync_snapshot


@pytest.mark.django_db
def test_sync_replaces_only_target_accounts_repertoire_data():
    source = User.objects.create_user(username="render-user")
    target = User.objects.create_user(username="matt.mcclelland")
    other = User.objects.create_user(username="other-local-user")
    profile = RepertoireProfile.objects.create(owner=source, name="Official")
    module = Repertoire.objects.create(owner=source, name="Vienna", color=Repertoire.WHITE)
    ProfileModule.objects.create(profile=profile, module=module, sort_order=3, enabled=False)
    move = RepertoireMove.objects.create(
        repertoire=module,
        origin_fen="origin w - -",
        san="e4",
        uci="e2e4",
        resulting_fen="result b - -",
        sort_order=2,
    )
    line = RepertoireLine.objects.create(
        repertoire=module,
        line_key="a" * 64,
        uci_path="e2e4",
        label="Main line",
        annotations=[{"ply": 0, "text": "Start here"}],
    )
    RepertoireLineStep.objects.create(line=line, ply=0, move=move)
    Repertoire.objects.create(owner=target, name="Local scratch", color=Repertoire.BLACK)
    untouched = Repertoire.objects.create(owner=other, name="Keep me", color=Repertoire.WHITE)

    snapshot = capture_sync_snapshot(using="default", username=source.username)
    counts = apply_sync_snapshot(
        snapshot=snapshot, using="default", target_username=target.username
    )

    assert counts["modules"] == 1
    copied = Repertoire.objects.get(owner=target)
    assert copied.name == "Vienna"
    assert copied.lines.get().annotations == [{"ply": 0, "text": "Start here"}]
    assert copied.lines.get().steps.get().move.uci == "e2e4"
    link = ProfileModule.objects.get(profile__owner=target)
    assert (link.sort_order, link.enabled) == (3, False)
    assert Repertoire.objects.filter(pk=untouched.pk).exists()


@pytest.mark.django_db
def test_sync_replaces_conflicting_release_in_place():
    source = User.objects.create_user(username="render-user")
    target = User.objects.create_user(username="matt.mcclelland")
    Repertoire.objects.create(owner=source, name="Source", color=Repertoire.WHITE)
    tree, lines = build_snapshot("caro-kann", [["e2e4", "c7c6"]])
    template = OpeningTemplate.objects.create(
        slug="caro-kann", name="Caro-Kann", color=Repertoire.BLACK, is_published=True
    )
    release = OpeningTemplateRelease.objects.create(
        template=template, version=1, tree=tree, lines=lines, changelog="Render"
    )
    snapshot = capture_sync_snapshot(using="default", username=source.username)
    OpeningTemplateRelease.objects.filter(pk=release.pk).update(
        tree={}, lines=[], changelog="Local conflict"
    )

    apply_sync_snapshot(snapshot=snapshot, using="default", target_username=target.username)

    release.refresh_from_db()
    assert (release.tree, release.lines, release.changelog) == (tree, lines, "Render")
