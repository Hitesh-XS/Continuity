import uuid

import pytest

from projects.models import Project

pytestmark = pytest.mark.django_db
LIST = "/api/v1/projects/"


def detail(pk) -> str:
    return f"/api/v1/projects/{pk}/"


def test_requires_authentication(api_client):
    assert api_client.get(LIST).status_code == 401
    assert api_client.post(LIST, {"name": "x"}, format="json").status_code == 401


def test_create_project_with_defaults(alice, client_for):
    response = client_for(alice).post(LIST, {"name": "My project"}, format="json")
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "My project"
    assert body["status"] == "active"
    assert body["sync_mode"] == "metadata_only"
    assert "owner" not in body
    assert Project.objects.get(pk=body["id"]).owner == alice


def test_create_ignores_owner_in_body(alice, bob, client_for):
    response = client_for(alice).post(
        LIST, {"name": "Mine", "owner": str(bob.id)}, format="json"
    )
    assert response.status_code == 201
    assert Project.objects.get(pk=response.json()["id"]).owner == alice


@pytest.mark.parametrize(
    "body",
    [
        {"name": ""},
        {"name": "   "},
        {},
        {"name": "x", "status": "deleted"},
        {"name": "x", "sync_mode": "everything"},
        {"name": "x" * 201},
    ],
    ids=["blank", "whitespace", "missing", "bad-status", "bad-sync-mode", "too-long"],
)
def test_create_validation(alice, client_for, body):
    response = client_for(alice).post(LIST, body, format="json")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"
    assert Project.objects.count() == 0


def test_client_supplied_id_is_idempotent(alice, client_for):
    client = client_for(alice)
    project_id = str(uuid.uuid4())
    first = client.post(LIST, {"id": project_id, "name": "Local first"}, format="json")
    replay = client.post(LIST, {"id": project_id, "name": "Changed"}, format="json")
    assert first.status_code == 201
    assert first.json()["id"] == project_id
    assert replay.status_code == 200
    assert replay.json()["name"] == "Local first"  # replay never overwrites
    assert Project.objects.count() == 1


def test_client_supplied_id_owned_by_someone_else_conflicts(
    alice, bob, make_project, client_for
):
    victim = make_project(bob, name="Bob's project")
    response = client_for(alice).post(
        LIST, {"id": str(victim.id), "name": "Stolen"}, format="json"
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "id_conflict"
    victim.refresh_from_db()
    assert victim.owner == bob
    assert victim.name == "Bob's project"


def test_list_returns_only_own_projects_newest_first(alice, bob, make_project, client_for):
    older = make_project(alice, name="older")
    newer = make_project(alice, name="newer")
    make_project(bob, name="bobs")
    body = client_for(alice).get(LIST).json()
    assert body["count"] == 2
    assert [p["id"] for p in body["results"]] == [str(newer.id), str(older.id)]


def test_list_is_paginated(alice, make_project, client_for):
    for i in range(3):
        make_project(alice, name=f"p{i}")
    body = client_for(alice).get(LIST, {"page_size": 2}).json()
    assert body["count"] == 3
    assert len(body["results"]) == 2
    assert body["next"] is not None


def test_retrieve_own_project(alice, make_project, client_for):
    project = make_project(alice, name="Mine")
    response = client_for(alice).get(detail(project.id))
    assert response.status_code == 200
    assert response.json()["name"] == "Mine"


def test_retrieve_other_users_project_is_404(alice, bob, make_project, client_for):
    project = make_project(bob)
    response = client_for(alice).get(detail(project.id))
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_patch_updates_allowed_fields(alice, make_project, client_for):
    project = make_project(alice)
    response = client_for(alice).patch(
        detail(project.id),
        {"name": "Renamed", "status": "archived", "sync_mode": "selected_content"},
        format="json",
    )
    assert response.status_code == 200
    project.refresh_from_db()
    assert project.name == "Renamed"
    assert project.status == "archived"
    assert project.sync_mode == "selected_content"


def test_patch_cannot_change_id_owner_or_created_at(alice, bob, make_project, client_for):
    project = make_project(alice)
    response = client_for(alice).patch(
        detail(project.id),
        {
            "id": str(uuid.uuid4()),
            "owner": str(bob.id),
            "created_at": "2000-01-01T00:00:00Z",
            "name": "Renamed",
        },
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["id"] == str(project.id)
    project.refresh_from_db()
    assert project.owner_id == alice.id
    assert project.name == "Renamed"
    assert project.created_at.year != 2000


def test_patch_blank_name_rejected(alice, make_project, client_for):
    project = make_project(alice, name="Keep me")
    response = client_for(alice).patch(detail(project.id), {"name": ""}, format="json")
    assert response.status_code == 400
    project.refresh_from_db()
    assert project.name == "Keep me"


def test_patch_other_users_project_is_404(alice, bob, make_project, client_for):
    project = make_project(bob, name="Bob's")
    response = client_for(alice).patch(detail(project.id), {"name": "Hacked"}, format="json")
    assert response.status_code == 404
    project.refresh_from_db()
    assert project.name == "Bob's"


def test_delete_own_project(alice, make_project, client_for):
    project = make_project(alice)
    response = client_for(alice).delete(detail(project.id))
    assert response.status_code == 204
    assert not Project.objects.filter(pk=project.pk).exists()


def test_delete_other_users_project_is_404(alice, bob, make_project, client_for):
    project = make_project(bob)
    response = client_for(alice).delete(detail(project.id))
    assert response.status_code == 404
    assert Project.objects.filter(pk=project.pk).exists()


def test_put_not_allowed(alice, make_project, client_for):
    project = make_project(alice)
    response = client_for(alice).put(detail(project.id), {"name": "x"}, format="json")
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "method_not_allowed"