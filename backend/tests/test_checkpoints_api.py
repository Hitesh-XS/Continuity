import uuid

import pytest

from projects.models import Checkpoint, ImmutableCheckpointError, Project

pytestmark = pytest.mark.django_db
SELECTED = Project.SyncMode.SELECTED_CONTENT


def url(project_id) -> str:
    return f"/api/v1/projects/{project_id}/checkpoints/"


def detail(checkpoint_id) -> str:
    return f"/api/v1/checkpoints/{checkpoint_id}/"


def payload(**overrides) -> dict:
    body = {
        "objective": "Finish phase 3",
        "state_snapshot": {"schemaVersion": 1, "nextAction": "Write tests"},
    }
    body.update(overrides)
    return body


def test_metadata_only_project_rejects_checkpoints(alice, make_project, client_for):
    project = make_project(alice)  # defaults to metadata_only
    response = client_for(alice).post(url(project.id), payload(), format="json")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "sync_mode_forbids_checkpoints"
    assert Checkpoint.objects.count() == 0


def test_versions_are_sequential_and_list_is_light(alice, make_project, client_for):
    project = make_project(alice, sync_mode=SELECTED)
    client = client_for(alice)
    for expected in (1, 2, 3):
        response = client.post(url(project.id), payload(), format="json")
        assert response.status_code == 201
        body = response.json()
        assert body["version"] == expected
        assert body["project"] == str(project.id)
        assert body["state_snapshot"] == payload()["state_snapshot"]
        assert "created_by" not in body

    listing = client.get(url(project.id)).json()
    assert [c["version"] for c in listing["results"]] == [3, 2, 1]
    assert "state_snapshot" not in listing["results"][0]
    assert "rendered_package" not in listing["results"][0]


def test_versions_are_per_project(alice, make_project, client_for):
    first = make_project(alice, sync_mode=SELECTED)
    second = make_project(alice, sync_mode=SELECTED)
    client = client_for(alice)
    assert client.post(url(first.id), payload(), format="json").json()["version"] == 1
    assert client.post(url(first.id), payload(), format="json").json()["version"] == 2
    assert client.post(url(second.id), payload(), format="json").json()["version"] == 1


def test_optional_fields_are_stored(alice, make_project, client_for):
    project = make_project(alice, sync_mode=SELECTED)
    body = payload(
        reason="session_end",
        rendered_package="# Continuation checkpoint",
        estimated_tokens=1200,
        destination_profile={"providerId": "example", "targetBudget": 6000},
        user_edited=True,
    )
    response = client_for(alice).post(url(project.id), body, format="json")
    assert response.status_code == 201
    saved = response.json()
    assert saved["reason"] == "session_end"
    assert saved["rendered_package"] == "# Continuation checkpoint"
    assert saved["estimated_tokens"] == 1200
    assert saved["destination_profile"]["targetBudget"] == 6000
    assert saved["user_edited"] is True


def test_replay_with_same_id_returns_existing(alice, make_project, client_for):
    project = make_project(alice, sync_mode=SELECTED)
    client = client_for(alice)
    checkpoint_id = str(uuid.uuid4())
    first = client.post(
        url(project.id), payload(id=checkpoint_id, objective="Original"), format="json"
    )
    replay = client.post(
        url(project.id), payload(id=checkpoint_id, objective="Changed"), format="json"
    )
    assert first.status_code == 201
    assert replay.status_code == 200
    assert replay.json()["objective"] == "Original"
    assert replay.json()["version"] == 1
    assert Checkpoint.objects.count() == 1


def test_id_reused_in_another_project_conflicts(alice, make_project, client_for):
    first = make_project(alice, sync_mode=SELECTED)
    second = make_project(alice, sync_mode=SELECTED)
    client = client_for(alice)
    checkpoint_id = str(uuid.uuid4())
    assert client.post(url(first.id), payload(id=checkpoint_id), format="json").status_code == 201
    response = client.post(url(second.id), payload(id=checkpoint_id), format="json")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "id_conflict"
    assert second.checkpoints.count() == 0


def test_id_belonging_to_another_user_conflicts_without_leaking(
    alice, bob, make_project, make_checkpoint, client_for
):
    bobs = make_project(bob, sync_mode=SELECTED)
    bobs_checkpoint = make_checkpoint(bobs, objective="bob-secret")
    mine = make_project(alice, sync_mode=SELECTED)
    response = client_for(alice).post(
        url(mine.id), payload(id=str(bobs_checkpoint.id)), format="json"
    )
    assert response.status_code == 409
    assert "bob-secret" not in response.content.decode()
    assert mine.checkpoints.count() == 0


@pytest.mark.parametrize(
    "overrides",
    [
        {"objective": ""},
        {"objective": "x" * 2001},
        {"state_snapshot": "just text"},
        {"state_snapshot": ["a", "b"]},
        {"reason": "whenever"},
        {"schema_version": 99},
        {"estimated_tokens": -1},
    ],
    ids=[
        "blank-objective",
        "long-objective",
        "snapshot-string",
        "snapshot-list",
        "bad-reason",
        "bad-schema-version",
        "negative-tokens",
    ],
)
def test_create_validation(alice, make_project, client_for, overrides):
    project = make_project(alice, sync_mode=SELECTED)
    response = client_for(alice).post(url(project.id), payload(**overrides), format="json")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"
    assert Checkpoint.objects.count() == 0


def test_missing_required_fields(alice, make_project, client_for):
    project = make_project(alice, sync_mode=SELECTED)
    client = client_for(alice)
    no_objective = client.post(url(project.id), {"state_snapshot": {}}, format="json")
    no_snapshot = client.post(url(project.id), {"objective": "x"}, format="json")
    assert no_objective.status_code == no_snapshot.status_code == 400
    assert "objective" in no_objective.json()["error"]["details"]
    assert "state_snapshot" in no_snapshot.json()["error"]["details"]


def test_oversized_snapshot_is_rejected(alice, make_project, client_for):
    project = make_project(alice, sync_mode=SELECTED)
    body = payload(state_snapshot={"blob": "x" * (300 * 1024)})
    response = client_for(alice).post(url(project.id), body, format="json")
    assert response.status_code == 400
    assert "state_snapshot" in response.json()["error"]["details"]
    assert Checkpoint.objects.count() == 0


def test_retrieve_own_checkpoint(alice, make_project, make_checkpoint, client_for):
    project = make_project(alice, sync_mode=SELECTED)
    checkpoint = make_checkpoint(project, objective="Ship it")
    response = client_for(alice).get(detail(checkpoint.id))
    assert response.status_code == 200
    body = response.json()
    assert body["objective"] == "Ship it"
    assert body["state_snapshot"]["nextAction"] == "Run the tests"


@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_checkpoint_endpoint_is_read_only(alice, make_project, make_checkpoint, client_for, method):
    project = make_project(alice, sync_mode=SELECTED)
    checkpoint = make_checkpoint(project)
    response = getattr(client_for(alice), method)(detail(checkpoint.id), {}, format="json")
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "method_not_allowed"


def test_existing_checkpoint_cannot_be_modified_in_code(alice, make_project, make_checkpoint):
    project = make_project(alice, sync_mode=SELECTED)
    checkpoint = make_checkpoint(project, objective="Original")
    checkpoint.objective = "Changed"
    with pytest.raises(ImmutableCheckpointError):
        checkpoint.save()
    checkpoint.refresh_from_db()
    assert checkpoint.objective == "Original"


def test_downgrading_to_metadata_only_keeps_reads_but_blocks_uploads(
    alice, make_project, make_checkpoint, client_for
):
    project = make_project(alice, sync_mode=SELECTED)
    checkpoint = make_checkpoint(project)
    client = client_for(alice)
    patch = client.patch(
        f"/api/v1/projects/{project.id}/", {"sync_mode": "metadata_only"}, format="json"
    )
    assert patch.status_code == 200
    assert client.get(url(project.id)).json()["count"] == 1
    assert client.get(detail(checkpoint.id)).status_code == 200
    assert client.post(url(project.id), payload(), format="json").status_code == 403


def test_deleting_a_project_deletes_its_checkpoints(
    alice, make_project, make_checkpoint, client_for
):
    project = make_project(alice, sync_mode=SELECTED)
    make_checkpoint(project)
    make_checkpoint(project)
    response = client_for(alice).delete(f"/api/v1/projects/{project.id}/")
    assert response.status_code == 204
    assert Checkpoint.objects.count() == 0
