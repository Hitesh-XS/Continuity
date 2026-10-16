from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", include("common.urls")),
    # Everything under /api/v1/ is the versioned public API. Later phases add
    # their includes here (projects, checkpoints, sync, ...).
    path("api/v1/", include("accounts.urls")),
]
