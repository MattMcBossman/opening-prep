import pytest
from rest_framework.test import APIClient

from accounts.models import User
from repertoire.models import OpeningTemplate, Repertoire

START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"


@pytest.mark.django_db
def test_owner_can_publish_module_and_create_new_immutable_release():
    owner = User.objects.create_user(username="publisher")
    client = APIClient()
    client.force_authenticate(owner)
    module = Repertoire.objects.create(owner=owner, name="My Vienna", color="white")
    line = {"steps": [{"originFen": START, "san": "e4", "uci": "e2e4", "resultingFen": AFTER_E4}]}
    assert client.post(f"/api/v1/repertoires/{module.id}/lines/", line, format="json").status_code == 200

    first = client.post("/api/v1/opening-templates/publish/", {"moduleId": module.id}, format="json")
    second = client.post("/api/v1/opening-templates/publish/", {"moduleId": module.id}, format="json")

    assert first.status_code == second.status_code == 201
    template = OpeningTemplate.objects.get(source_module=module)
    assert template.kind == OpeningTemplate.COMMUNITY
    assert template.publisher == owner
    assert list(template.releases.values_list("version", flat=True)) == [2, 1]
    listing = APIClient().get("/api/v1/opening-templates/")
    community = next(item for item in listing.data if item["slug"] == template.slug)
    assert community["kind"] == "community"
    assert community["publisherName"] == "publisher"


@pytest.mark.django_db
def test_user_cannot_publish_someone_elses_module():
    owner = User.objects.create_user(username="owner")
    stranger = User.objects.create_user(username="stranger")
    module = Repertoire.objects.create(owner=owner, name="Private", color="black")
    client = APIClient()
    client.force_authenticate(stranger)
    assert (
        client.post("/api/v1/opening-templates/publish/", {"moduleId": module.id}, format="json").status_code
        == 404
    )
