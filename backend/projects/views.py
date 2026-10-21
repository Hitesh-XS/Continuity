from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.generics import (
    ListCreateAPIView,
    RetrieveDestroyAPIView,
    RetrieveUpdateDestroyAPIView,
    get_object_or_404,
)
from rest_framework.response import Response

from common.errors import Conflict

from . import services
from .models import Checkpoint, Project
from .serializers import (
    CheckpointCreateSerializer,
    CheckpointListSerializer,
    CheckpointSerializer,
    ProjectCreateSerializer,
    ProjectSerializer,
)


class ProjectListCreateView(ListCreateAPIView):
    serializer_class = ProjectSerializer

    def get_queryset(self):
        # Ownership is enforced here: other users' rows are simply not in the queryset.
        return Project.objects.filter(owner=self.request.user).order_by("-updated_at", "id")

    def create(self, request, *args, **kwargs):
        serializer = ProjectCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            project, created = services.create_project(
                owner=request.user, **serializer.validated_data
            )
        except services.ProjectIdConflictError as exc:
            raise Conflict(detail="This ID is already in use.", code="id_conflict") from exc
        code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(ProjectSerializer(project).data, status=code)


class ProjectDetailView(RetrieveUpdateDestroyAPIView):
    serializer_class = ProjectSerializer
    lookup_field = "id"
    lookup_url_kwarg = "project_id"
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return Project.objects.filter(owner=self.request.user)


class ProjectCheckpointListCreateView(ListCreateAPIView):
    serializer_class = CheckpointListSerializer

    def _get_project(self) -> Project:
        return get_object_or_404(
            Project.objects.filter(owner=self.request.user), pk=self.kwargs["project_id"]
        )

    def get_queryset(self):
        project = self._get_project()
        return Checkpoint.objects.filter(project=project).order_by("-version")

    def create(self, request, *args, **kwargs):
        project = self._get_project()  # 404 before anything else for foreign projects
        serializer = CheckpointCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            checkpoint, created = services.create_checkpoint(
                owner=request.user, project_id=project.id, **serializer.validated_data
            )
        except services.ProjectNotFoundError as exc:
            raise NotFound() from exc
        except services.SyncModeForbidsCheckpointsError as exc:
            raise PermissionDenied(
                detail="This project is metadata-only. Change its sync mode to upload checkpoints.",
                code="sync_mode_forbids_checkpoints",
            ) from exc
        except services.CheckpointIdConflictError as exc:
            raise Conflict(detail="This ID is already in use.", code="id_conflict") from exc
        code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(CheckpointSerializer(checkpoint).data, status=code)


class CheckpointDetailView(RetrieveDestroyAPIView):
    """Content is immutable (no PUT or PATCH). The owner may delete a whole checkpoint."""

    serializer_class = CheckpointSerializer
    lookup_field = "id"
    lookup_url_kwarg = "checkpoint_id"

    def get_queryset(self):
        return Checkpoint.objects.filter(project__owner=self.request.user)