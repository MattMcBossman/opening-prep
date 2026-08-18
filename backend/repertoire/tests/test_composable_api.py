import pytest
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

from accounts.models import User
from common.fen import normalize_fen
from repertoire.models import (
    OpeningTemplate,
    OpeningTemplateRelease,
    Repertoire,
    RepertoireLine,
    RepertoireProfile,
)

START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"


@pytest.fixture
def owner(db):
    return User.objects.create_user(username="composer")


@pytest.fixture
def client(owner):
    result = APIClient()
    result.force_authenticate(owner)
    return result


def test_authored_line_is_idempotent_and_delete_prunes_graph(client, owner):
    module = Repertoire.objects.create(owner=owner, name="Vienna", color="white")
    payload = {
        "label": "King pawn",
        "steps": [
            {
                "originFen": START,
                "san": "e4",
                "uci": "e2e4",
                "resultingFen": AFTER_E4,
            }
        ],
    }
    first = client.post(f"/api/v1/repertoires/{module.id}/lines/", payload, format="json")
    second = client.post(f"/api/v1/repertoires/{module.id}/lines/", payload, format="json")
    assert first.status_code == second.status_code == 200
    assert RepertoireLine.objects.filter(repertoire=module).count() == 1
    metadata_update = client.post(
        f"/api/v1/repertoires/{module.id}/lines/",
        {
            **payload,
            "label": "Updated label",
            "source": "pgn_import",
            "annotations": [{"ply": 0, "comment": "Controls the center", "nags": [1]}],
        },
        format="json",
    )
    assert metadata_update.status_code == 200
    assert RepertoireLine.objects.get(repertoire=module).label == "Updated label"
    assert RepertoireLine.objects.get(repertoire=module).source == "pgn_import"
    assert RepertoireLine.objects.get(repertoire=module).annotations == [
        {"ply": 0, "comment": "Controls the center", "nags": [1]}
    ]
    assert module.moves.get().origin_fen == normalize_fen(START)
    line_id = first.data[0]["id"]
    assert client.delete(f"/api/v1/repertoires/{module.id}/lines/{line_id}/").status_code == 204
    assert not module.moves.exists()


def test_authored_line_rejects_annotation_outside_path(client, owner):
    module = Repertoire.objects.create(owner=owner, name="Annotated", color="white")
    response = client.post(
        f"/api/v1/repertoires/{module.id}/lines/",
        {
            "steps": [{"originFen": START, "san": "e4", "uci": "e2e4", "resultingFen": AFTER_E4}],
            "annotations": [{"ply": 2, "comment": "Too late"}],
        },
        format="json",
    )
    assert response.status_code == 400
    assert "annotations" in response.data


def test_global_release_can_be_copied_into_editable_module(client, owner):
    template = OpeningTemplate.objects.create(slug="vienna", name="Vienna", color="white", is_published=True)
    release = OpeningTemplateRelease.objects.create(
        template=template,
        version=1,
        tree={normalize_fen(START): [{"san": "e4", "uci": "e2e4", "resultingFen": normalize_fen(AFTER_E4)}]},
        lines=[
            {
                "id": "vienna-main",
                "label": "Vienna main line",
                "source": "manual",
                "sortOrder": 3,
                "steps": [
                    {
                        "originFen": normalize_fen(START),
                        "san": "e4",
                        "uci": "e2e4",
                        "resultingFen": normalize_fen(AFTER_E4),
                    }
                ],
            }
        ],
    )
    profile = RepertoireProfile.objects.create(owner=owner, name="Tournament")
    copied = client.post(
        "/api/v1/opening-templates/vienna/releases/1/copy/",
        {"name": "My Vienna", "profileId": profile.id},
        format="json",
    )
    assert copied.status_code == 201
    module = Repertoire.objects.get(pk=copied.data["id"])
    assert module.source_release == release
    assert module.moves.count() == 1
    copied_line = module.lines.get()
    assert copied_line.label == "Vienna main line"
    assert copied_line.source == "manual"
    assert copied_line.sort_order == 3

    target = Repertoire.objects.create(owner=owner, name="My gaps", color="white")
    first_fill = client.post(
        "/api/v1/opening-templates/vienna/releases/1/copy-missing/",
        {"moduleId": target.id},
        format="json",
    )
    second_fill = client.post(
        "/api/v1/opening-templates/vienna/releases/1/copy-missing/",
        {"moduleId": target.id},
        format="json",
    )
    assert first_fill.data == {"added": 1, "skipped": 0, "conflicts": []}
    assert second_fill.data == {"added": 0, "skipped": 1, "conflicts": []}
    assert target.lines.get().label == "Vienna main line"


def test_global_release_rejects_invalid_or_disconnected_snapshots(db):
    template = OpeningTemplate.objects.create(slug="broken", name="Broken", color="white")
    with pytest.raises(ValidationError, match="authored lines"):
        OpeningTemplateRelease.objects.create(
            template=template,
            version=1,
            tree={
                normalize_fen(START): [{"san": "e4", "uci": "e2e4", "resultingFen": normalize_fen(AFTER_E4)}]
            },
        )

    with pytest.raises(ValidationError, match="reference an edge"):
        OpeningTemplateRelease.objects.create(
            template=template,
            version=2,
            lines=[
                {
                    "id": "bad-line",
                    "steps": [
                        {
                            "originFen": normalize_fen(START),
                            "san": "e4",
                            "uci": "e2e4",
                            "resultingFen": normalize_fen(AFTER_E4),
                        }
                    ],
                }
            ],
        )


def test_unpublished_template_is_not_public(client):
    OpeningTemplate.objects.create(slug="secret", name="Secret", color="black")
    assert client.get("/api/v1/opening-templates/").data == []


def test_published_template_and_release_are_public_without_authentication(db):
    template = OpeningTemplate.objects.create(
        slug="public-vienna", name="Public Vienna", color="white", is_published=True
    )
    release = OpeningTemplateRelease.objects.create(
        template=template,
        version=1,
        tree={normalize_fen(START): [{"san": "e4", "uci": "e2e4", "resultingFen": normalize_fen(AFTER_E4)}]},
        lines=[
            {
                "id": "public-main",
                "steps": [
                    {
                        "originFen": normalize_fen(START),
                        "san": "e4",
                        "uci": "e2e4",
                        "resultingFen": normalize_fen(AFTER_E4),
                    }
                ],
            }
        ],
    )
    anonymous = APIClient()

    listing = anonymous.get("/api/v1/opening-templates/")
    detail = anonymous.get(f"/api/v1/opening-templates/{template.slug}/releases/{release.version}/")

    assert listing.status_code == 200
    assert listing.data[0]["latestRelease"]["moveCount"] == 1
    assert [item["slug"] for item in listing.data] == ["public-vienna"]
    assert detail.status_code == 200
    assert detail.data["tree"][normalize_fen(START)][0]["uci"] == "e2e4"
