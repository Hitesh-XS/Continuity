import json
from typing import Any

from rest_framework import serializers

from .models import Checkpoint, Project

SUPPORTED_SCHEMA_VERSIONS = {1}
MAX_STATE_SNAPSHOT_BYTES = 256 * 1024
MAX_DESTINATION_PROFILE_BYTES = 16 * 1024


def _json_size(value: Any) -> int:
    return len(json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = (
            "id",
            "name",
            "description",
            "current_goal",
            "status",
            "sync_mode",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


class ProjectCreateSerializer(ProjectSerializer):
    """Same as ProjectSerializer, but lets the client choose the new project's UUID."""

    id = serializers.UUIDField(required=False)

    class Meta(ProjectSerializer.Meta):
        read_only_fields = ("created_at", "updated_at")


class CheckpointSerializer(serializers.ModelSerializer):
    """Full read view. Every field is read-only: checkpoints are never edited."""

    class Meta:
        model = Checkpoint
        fields = (
            "id",
            "project",
            "version",
            "reason",
            "schema_version",
            "objective",
            "state_snapshot",
            "rendered_package",
            "estimated_tokens",
            "destination_profile",
            "user_edited",
            "created_at",
        )
        read_only_fields = fields


class CheckpointListSerializer(serializers.ModelSerializer):
    """Light view for lists: no snapshot or rendered package."""

    class Meta:
        model = Checkpoint
        fields = (
            "id",
            "version",
            "reason",
            "schema_version",
            "objective",
            "estimated_tokens",
            "user_edited",
            "created_at",
        )
        read_only_fields = fields


class CheckpointCreateSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    reason = serializers.ChoiceField(choices=Checkpoint.Reason.choices, default="manual")
    schema_version = serializers.IntegerField(default=1)
    objective = serializers.CharField(max_length=2000)
    state_snapshot = serializers.JSONField()
    rendered_package = serializers.CharField(
        max_length=200_000, required=False, allow_blank=True, trim_whitespace=False
    )
    estimated_tokens = serializers.IntegerField(
        min_value=0, max_value=10_000_000, required=False, allow_null=True
    )
    destination_profile = serializers.JSONField(required=False)
    user_edited = serializers.BooleanField(default=False)

    def validate_schema_version(self, value: int) -> int:
        if value not in SUPPORTED_SCHEMA_VERSIONS:
            raise serializers.ValidationError("Unsupported schema version.")
        return value

    def validate_state_snapshot(self, value: Any) -> dict:
        if not isinstance(value, dict):
            raise serializers.ValidationError("Must be a JSON object.")
        if _json_size(value) > MAX_STATE_SNAPSHOT_BYTES:
            raise serializers.ValidationError("Snapshot is too large.")
        return value

    def validate_destination_profile(self, value: Any) -> dict:
        if not isinstance(value, dict):
            raise serializers.ValidationError("Must be a JSON object.")
        if _json_size(value) > MAX_DESTINATION_PROFILE_BYTES:
            raise serializers.ValidationError("Destination profile is too large.")
        return value