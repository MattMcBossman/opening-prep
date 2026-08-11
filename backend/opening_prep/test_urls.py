from pathlib import Path

import pytest
from django.test import Client, override_settings


def test_health_is_database_independent():
    response = Client().get("/api/v1/health/")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.django_db
def test_readiness_checks_database():
    response = Client().get("/api/v1/ready/")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_spa_routes_serve_uncached_index(tmp_path: Path):
    (tmp_path / "index.html").write_text("<main>Mainline</main>")

    with override_settings(FRONTEND_DIST_DIR=tmp_path):
        response = Client().get("/repertoire/deep-link")

    assert response.status_code == 200
    assert response.get("Cache-Control") == "no-cache"
    assert b"<main>Mainline</main>" in b"".join(response.streaming_content)


def test_privacy_page_is_public():
    response = Client().get("/privacy/")

    assert response.status_code == 200
    assert b"Mainline alpha privacy notice" in response.content
    assert b"temporary, invite-only alpha" in response.content


def test_unknown_api_route_does_not_return_spa(tmp_path: Path):
    (tmp_path / "index.html").write_text("<main>Mainline</main>")

    with override_settings(FRONTEND_DIST_DIR=tmp_path):
        response = Client().get("/api/not-a-real-route")

    assert response.status_code == 404
