import logging
from typing import Any
from uuid import UUID

from django.db import IntegrityError, transaction
from django.db.models import Max

from accounts.models import User

from .models import Checkpoint, Project

logger = logging.getLogger(__name__)


class ProjectIdConflictError(Exception):
    """The client-supplied project ID already belongs to someone else."""


class ProjectNotFoundError(Exception):
    """No such project for this owner (also used when it belongs to another user)."""


class CheckpointIdConflictError(Exception):
    """The client-supplied checkpoint ID is already used elsewhere."""


class SyncModeForbidsCheckpointsError(Exception):
    """The project is metadata_only, so the server refuses checkpoint content."""


def create_project(*, owner: User, **fields: Any) -> tuple[Project, bool]:
    """Create a project. Returns (project, created).

    With a client-supplied ``id``, repeating the same request returns the existing
    project (created=False) instead of creating a duplicate. The database primary
    key is the final arbiter, so concurrent retries are safe.
    """
    project_id = fields.pop("id", None)
    if project_id is None:
        return Project.objects.create(owner=owner, **fields), True
    try:
        with transaction.atomic():
            return Project.objects.create(id=project_id, owner=owner, **fields), True
    except IntegrityError:
        existing = Project.objects.filter(pk=project_id).first()
        if existing is None:
            raise  # some other constraint failed; do not mask it
        if existing.owner_id == owner.id:
            return existing, False
        raise ProjectIdConflictError from None


def create_checkpoint(*, owner: User, project_id: UUID, **fields: Any) -> tuple[Checkpoint, bool]:
    """Create the next immutable version of a project's checkpoints.

    The project row is locked for the duration of the transaction, so concurrent
    saves are serialized and versions are gapless and unique.
    """
    checkpoint_id = fields.pop("id", None)
    with transaction.atomic():
        project = Project.objects.select_for_update().filter(pk=project_id, owner=owner).first()
        if project is None:
            raise ProjectNotFoundError

        if checkpoint_id is not None:
            existing = Checkpoint.objects.filter(pk=checkpoint_id).first()
            if existing is not None:
                if existing.project_id == project.id:
                    return existing, False  # idempotent replay
                raise CheckpointIdConflictError

        if project.sync_mode == Project.SyncMode.METADATA_ONLY:
            raise SyncModeForbidsCheckpointsError

        latest = (
            Checkpoint.objects.filter(project=project).aggregate(latest=Max("version"))["latest"]
            or 0
        )
        extra = {"id": checkpoint_id} if checkpoint_id is not None else {}
        try:
            with transaction.atomic():
                checkpoint = Checkpoint.objects.create(
                    project=project, version=latest + 1, created_by=owner, **extra, **fields
                )
        except IntegrityError as exc:
            raise CheckpointIdConflictError from exc

        project.save(update_fields=["updated_at"])  # surfaces recent activity in lists

    # IDs only. Never log checkpoint content.
    logger.info("Checkpoint created project=%s version=%s", project.id, checkpoint.version)
    return checkpoint, True
