"""
API-level tests for `repertoire/urls.py`'s endpoints. Cascade-delete rule
correctness itself is covered exhaustively in `test_cascade.py` against plain
dicts; these tests cover the HTTP/DB layer wrapped around it - ownership,
request validation, atomicity, and idempotency.
"""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from common.fen import normalize_fen
from repertoire.models import (
    ProfileModule,
    Repertoire,
    RepertoireLine,
    RepertoireLineStep,
    RepertoireMove,
    RepertoireProfile,
)

User = get_user_model()

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
AFTER_E4_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2"


@pytest.fixture
def user(db):
    return User.objects.create_user(username="alice")


@pytest.fixture
def other_user(db):
    return User.objects.create_user(username="mallory")


@pytest.fixture
def client(user):
    api_client = APIClient()
    api_client.force_authenticate(user)
    return api_client


@pytest.fixture
def repertoire(user):
    return Repertoire.objects.create(owner=user, name="Default", color=Repertoire.WHITE)


@pytest.mark.django_db
class TestRepertoireListCreate:
    def test_list_only_returns_callers_repertoires(self, client, user, other_user):
        Repertoire.objects.create(owner=user, name="Mine", color=Repertoire.WHITE)
        Repertoire.objects.create(owner=other_user, name="Not mine", color=Repertoire.BLACK)

        response = client.get("/api/v1/repertoires/")

        assert response.status_code == 200
        assert [r["name"] for r in response.data] == ["Mine"]

    def test_create_assigns_the_caller_as_owner(self, client, user):
        response = client.post("/api/v1/repertoires/", {"name": "My Black Prep", "color": "black"})

        assert response.status_code == 201
        assert response.data["moveCount"] == 0
        assert response.data["lineCount"] == 0
        created = Repertoire.objects.get(pk=response.data["id"])
        assert created.owner == user
        profile = RepertoireProfile.objects.get(owner=user, name="Default")
        assert ProfileModule.objects.filter(profile=profile, module=created).exists()


@pytest.mark.django_db
class TestProfiles:
    def test_create_and_list_profile(self, client, user):
        response = client.post(
            "/api/v1/repertoires/profiles/",
            {"name": "Tournament", "description": "Main classical preparation"},
            format="json",
        )

        assert response.status_code == 201
        assert response.data["name"] == "Tournament"
        assert response.data["modules"] == []
        assert RepertoireProfile.objects.get(id=response.data["id"]).owner == user

        listed = client.get("/api/v1/repertoires/profiles/")
        assert [profile["name"] for profile in listed.data] == ["Tournament"]

    def test_add_disable_as_detach_and_remove_module_without_deleting_it(self, client, user):
        profile = RepertoireProfile.objects.create(owner=user, name="Blitz")
        module = Repertoire.objects.create(owner=user, name="Vienna Game", color=Repertoire.WHITE)

        added = client.post(
            f"/api/v1/repertoires/profiles/{profile.id}/modules/",
            {"moduleId": module.id, "sortOrder": 3},
            format="json",
        )
        assert added.status_code == 200
        assert added.data["modules"][0]["name"] == "Vienna Game"
        assert added.data["modules"][0]["sortOrder"] == 3

        updated = client.post(
            f"/api/v1/repertoires/profiles/{profile.id}/modules/",
            {"moduleId": module.id, "sortOrder": 1, "enabled": False},
            format="json",
        )
        assert updated.data["modules"] == []
        assert ProfileModule.objects.filter(profile=profile, module=module).count() == 0

        client.post(
            f"/api/v1/repertoires/profiles/{profile.id}/modules/",
            {"moduleId": module.id},
            format="json",
        )

        removed = client.delete(
            f"/api/v1/repertoires/profiles/{profile.id}/modules/",
            {"moduleId": module.id},
            format="json",
        )
        assert removed.status_code == 200
        assert removed.data["modules"] == []
        assert Repertoire.objects.filter(id=module.id).exists()

    def test_cannot_attach_another_users_module(self, client, user, other_user):
        profile = RepertoireProfile.objects.create(owner=user, name="Mine")
        module = Repertoire.objects.create(owner=other_user, name="Theirs", color=Repertoire.BLACK)

        response = client.post(
            f"/api/v1/repertoires/profiles/{profile.id}/modules/",
            {"moduleId": module.id},
            format="json",
        )

        assert response.status_code == 404
        assert not ProfileModule.objects.filter(profile=profile).exists()


@pytest.mark.django_db
class TestOwnership:
    def test_tree_view_404s_for_someone_elses_repertoire(self, client, other_user):
        theirs = Repertoire.objects.create(owner=other_user, name="Theirs", color=Repertoire.WHITE)

        response = client.get(f"/api/v1/repertoires/{theirs.id}/tree/")

        assert response.status_code == 404

    def test_moves_view_404s_for_someone_elses_repertoire(self, client, other_user):
        theirs = Repertoire.objects.create(owner=other_user, name="Theirs", color=Repertoire.WHITE)

        response = client.delete(
            f"/api/v1/repertoires/{theirs.id}/moves/", {"originFen": START_FEN, "uci": "e2e4"}, format="json"
        )

        assert response.status_code == 404


@pytest.mark.django_db
class TestAddMoves:
    def test_adds_moves_and_returns_the_updated_tree(self, client, repertoire):
        body = {
            "moves": [
                {"originFen": START_FEN, "san": "e4", "uci": "e2e4", "resultingFen": AFTER_E4},
                {"originFen": AFTER_E4, "san": "e5", "uci": "e7e5", "resultingFen": AFTER_E4_E5},
            ]
        }

        response = client.post(f"/api/v1/repertoires/{repertoire.id}/moves/", body, format="json")

        assert response.status_code == 200
        assert response.data[normalize_fen(START_FEN)] == [
            {"san": "e4", "uci": "e2e4", "resultingFen": normalize_fen(AFTER_E4)}
        ]
        assert RepertoireMove.objects.filter(repertoire=repertoire).count() == 2
        line = RepertoireLine.objects.get(repertoire=repertoire)
        assert line.uci_path == "e2e4 e7e5"
        assert list(line.steps.values_list("move__uci", flat=True)) == ["e2e4", "e7e5"]

        lines_response = client.get(f"/api/v1/repertoires/{repertoire.id}/lines/")
        assert lines_response.status_code == 200
        assert lines_response.data[0]["uciPath"] == "e2e4 e7e5"
        assert [step["uci"] for step in lines_response.data[0]["steps"]] == ["e2e4", "e7e5"]

    def test_adding_an_existing_edge_is_a_noop(self, client, repertoire):
        body = {"moves": [{"originFen": START_FEN, "san": "e4", "uci": "e2e4", "resultingFen": AFTER_E4}]}
        client.post(f"/api/v1/repertoires/{repertoire.id}/moves/", body, format="json")

        response = client.post(f"/api/v1/repertoires/{repertoire.id}/moves/", body, format="json")

        assert response.status_code == 200
        assert RepertoireMove.objects.filter(repertoire=repertoire).count() == 1
        assert RepertoireLine.objects.filter(repertoire=repertoire).count() == 1

    def test_adding_a_sibling_response_is_rejected(self, client, repertoire):
        first = {"moves": [{"originFen": START_FEN, "san": "e4", "uci": "e2e4", "resultingFen": AFTER_E4}]}
        client.post(f"/api/v1/repertoires/{repertoire.id}/moves/", first, format="json")

        after_d4 = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1"
        second = {"moves": [{"originFen": START_FEN, "san": "d4", "uci": "d2d4", "resultingFen": after_d4}]}
        response = client.post(f"/api/v1/repertoires/{repertoire.id}/moves/", second, format="json")

        assert response.status_code == 409
        assert response.data["code"] == "response_conflict"
        assert list(
            RepertoireLine.objects.filter(repertoire=repertoire).values_list("uci_path", flat=True)
        ) == ["e2e4"]

    def test_illegal_move_returns_400_and_saves_nothing(self, client, repertoire):
        body = {
            "moves": [
                # Legal, so it would otherwise be persisted first...
                {"originFen": START_FEN, "san": "e4", "uci": "e2e4", "resultingFen": AFTER_E4},
                # ...but this one is illegal (pawns don't move like this), so
                # the whole batch must be rejected atomically.
                {"originFen": AFTER_E4, "san": "bogus", "uci": "e7e4", "resultingFen": AFTER_E4_E5},
            ]
        }

        response = client.post(f"/api/v1/repertoires/{repertoire.id}/moves/", body, format="json")

        assert response.status_code == 400
        assert RepertoireMove.objects.filter(repertoire=repertoire).count() == 0

    def test_unparseable_fen_returns_400(self, client, repertoire):
        body = {"moves": [{"originFen": "not a fen", "san": "e4", "uci": "e2e4", "resultingFen": AFTER_E4}]}

        response = client.post(f"/api/v1/repertoires/{repertoire.id}/moves/", body, format="json")

        assert response.status_code == 400


@pytest.mark.django_db
class TestRemoveMove:
    def test_cascade_delete_is_applied_and_returns_updated_tree(self, client, repertoire):
        RepertoireMove.objects.create(
            repertoire=repertoire,
            origin_fen=normalize_fen(START_FEN),
            san="e4",
            uci="e2e4",
            resulting_fen=normalize_fen(AFTER_E4),
        )
        RepertoireMove.objects.create(
            repertoire=repertoire,
            origin_fen=normalize_fen(AFTER_E4),
            san="e5",
            uci="e7e5",
            resulting_fen=normalize_fen(AFTER_E4_E5),
        )

        response = client.delete(
            f"/api/v1/repertoires/{repertoire.id}/moves/",
            {"originFen": START_FEN, "uci": "e2e4"},
            format="json",
        )

        assert response.status_code == 200
        assert response.data == {}
        assert RepertoireMove.objects.filter(repertoire=repertoire).count() == 0
        assert RepertoireLine.objects.filter(repertoire=repertoire).count() == 0
        assert RepertoireLineStep.objects.filter(line__repertoire=repertoire).count() == 0

    def test_removing_a_nonexistent_edge_is_a_noop_not_an_error(self, client, repertoire):
        response = client.delete(
            f"/api/v1/repertoires/{repertoire.id}/moves/",
            {"originFen": START_FEN, "uci": "e2e4"},
            format="json",
        )

        assert response.status_code == 200
        assert response.data == {}


@pytest.mark.django_db
class TestImport:
    def test_import_creates_default_repertoires_and_reports_counts(self, client, user):
        body = {
            "white": {START_FEN: [{"san": "e4", "uci": "e2e4", "resultingFen": AFTER_E4}]},
            "black": {},
        }

        response = client.post("/api/v1/repertoires/import/", body, format="json")

        assert response.status_code == 200
        assert response.data == {
            "white": {"imported": 1, "skipped": 0, "conflicts": []},
            "black": {"imported": 0, "skipped": 0, "conflicts": []},
        }
        white = Repertoire.objects.get(owner=user, color=Repertoire.WHITE, name="Default")
        assert RepertoireMove.objects.filter(repertoire=white).count() == 1
        profile = RepertoireProfile.objects.get(owner=user, name="Default")
        assert ProfileModule.objects.filter(profile=profile, module=white).exists()
        assert RepertoireLine.objects.filter(repertoire=white, uci_path="e2e4").exists()

    def test_import_is_idempotent(self, client, user):
        body = {"white": {START_FEN: [{"san": "e4", "uci": "e2e4", "resultingFen": AFTER_E4}]}, "black": {}}
        client.post("/api/v1/repertoires/import/", body, format="json")

        response = client.post("/api/v1/repertoires/import/", body, format="json")

        assert response.data["white"] == {"imported": 0, "skipped": 1, "conflicts": []}
        white = Repertoire.objects.get(owner=user, color=Repertoire.WHITE, name="Default")
        assert RepertoireMove.objects.filter(repertoire=white).count() == 1

    def test_import_reuses_the_same_default_repertoire_on_repeat_calls(self, client, user):
        body = {"white": {}, "black": {}}
        client.post("/api/v1/repertoires/import/", body, format="json")
        client.post("/api/v1/repertoires/import/", body, format="json")

        assert Repertoire.objects.filter(owner=user, color=Repertoire.WHITE, name="Default").count() == 1
