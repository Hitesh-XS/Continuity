import uuid

from django.conf import settings
from django.db import models


class ImmutableCheckpointError(Exception):
    """Raised when code tries to modify an existing checkpoint."""


class Project(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active"
        PAUSED = "paused"
        ARCHIVED = "archived"

    class SyncMode(models.TextChoices):
        METADATA_ONLY = "metadata_only"
        SELECTED_CONTENT = "selected_content"
        FULL_TRANSCRIPT_OPT_IN = "full_transcript_opt_in"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="projects"
    )
    name = models.CharField(max_length=200)
    description = models.CharField(max_length=5000, blank=True, default="")
    current_goal = models.CharField(max_length=2000, blank=True, default="")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    sync_mode = models.CharField(
        max_length=30, choices=SyncMode.choices, default=SyncMode.METADATA_ONLY
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["owner", "-updated_at"], name="project_owner_updated_idx"),
            models.Index(fields=["owner", "status"], name="project_owner_status_idx"),
        ]
        constraints = [
            models.CheckConstraint(condition=~models.Q(name=""), name="project_name_not_blank"),
        ]

    def __str__(self) -> str:
        return self.name


class Checkpoint(models.Model):
    """An immutable, versioned snapshot of project state."""

    class Reason(models.TextChoices):
        MANUAL = "manual"
        ESTIMATED_PRESSURE = "estimated_pressure"
        SESSION_END = "session_end"
        PROVIDER_LIMIT_UI = "provider_limit_ui"
        RECOVERY = "recovery"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="checkpoints")
    version = models.PositiveIntegerField()
    reason = models.CharField(max_length=30, choices=Reason.choices, default=Reason.MANUAL)
    schema_version = models.PositiveSmallIntegerField(default=1)
    objective = models.CharField(max_length=2000)
    state_snapshot = models.JSONField()
    # Empty string means "no rendered package stored".
    rendered_package = models.TextField(blank=True, default="")
    estimated_tokens = models.PositiveIntegerField(null=True, blank=True)
    destination_profile = models.JSONField(default=dict, blank=True)
    user_edited = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["project", "version"], name="checkpoint_unique_version_per_project"
            ),
            models.CheckConstraint(
                condition=models.Q(version__gte=1), name="checkpoint_version_positive"
            ),
        ]
        
    def __str__(self) -> str:
        return f"{self.project_id} v{self.version}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ImmutableCheckpointError("Checkpoints are immutable; create a new version.")
        super().save(*args, **kwargs)


