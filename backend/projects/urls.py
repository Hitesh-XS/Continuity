from django.urls import path

from . import views

urlpatterns = [
    path("projects/", views.ProjectListCreateView.as_view(), name="project-list"),
    path("projects/<uuid:project_id>/", views.ProjectDetailView.as_view(), name="project-detail"),
    path(
        "projects/<uuid:project_id>/checkpoints/",
        views.ProjectCheckpointListCreateView.as_view(),
        name="project-checkpoints",
    ),
    path(
        "checkpoints/<uuid:checkpoint_id>/",
        views.CheckpointDetailView.as_view(),
        name="checkpoint-detail",
    ),
]
