from django.urls import path

from . import views

urlpatterns = [
    path("ai/status/", views.AIStatusView.as_view(), name="ai-status"),
    path("ai/consent/", views.AIConsentView.as_view(), name="ai-consent"),
    path("ai/extract-memory/", views.ExtractMemoryView.as_view(), name="ai-extract-memory"),
]
