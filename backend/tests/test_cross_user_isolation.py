import uuid

import pytest

from projects.models import Checkpoint, Project

pytestmark = pytest.mark.django_db

CASES = [
    ("get", "/api/v1/projects/{project}/", None),
    ("patch", "/api/v1/projects/{project}/", {"name": "hacked"}),
    ("delete", "/api/v1/projects/{project}/", None),
    ("get", "/api/v1/projects/{project}/checkpoints/", None),
    (
        "post",
        "/api/v1/projects/{project}/checkpoints/",
        {"objective": "x", "state_snapshot": {}},
    ),
    ("get", "/api/v1/checkpoints/{checkpoint}/", None),
]


@pytest.fixture
def victim_data(bob, make_project, make_checkpoint):
    project = make_project(bob, name="Bob private", sync_mode=Project.SyncMode.SELECTED_CONTENT)
    checkpoint = make_checkpoint(project, objective="bob-secret")
    return project, checkpoint


def _call(client, method: str, path: str, body):
    func = getattr(client, method)
    if body is None:
        return func(path)
    return func(path, body, format="json")


@pytest.mark.parametrize(("method", "template", "body"), CASES)
def test_intruder_gets_404_and_nothing_changes(
    alice, client_for, victim_data, method, template, body
):
    project, checkpoint = victim_data
    path = template.format(project=project.id, checkpoint=checkpoint.id)
    response = _call(client_for(alice), method, path, body)

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert "bob-secret" not in response.content.decode()
    project.refresh_from_db()  # raises if the intruder managed to delete it
    assert project.name == "Bob private"
    assert Checkpoint.objects.filter(project=project).count() == 1


@pytest.mark.parametrize(
    "template",
    [
        "/api/v1/projects/{project}/",
        "/api/v1/projects/{project}/checkpoints/",
        "/api/v1/checkpoints/{checkpoint}/",
    ],
)
def test_foreign_and_missing_ids_are_indistinguishable(alice, client_for, victim_data, template):
    project, checkpoint = victim_data
    client = client_for(alice)
    foreign = client.get(template.format(project=project.id, checkpoint=checkpoint.id))
    missing = client.get(template.format(project=uuid.uuid4(), checkpoint=uuid.uuid4()))
    assert foreign.status_code == missing.status_code == 404
    assert foreign.json() == missing.json()
