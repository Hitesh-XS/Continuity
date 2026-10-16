import pytest
from rest_framework.test import APIClient


@pytest.mark.django_db
def test_health_ok():
    response = APIClient().get("/health/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_health_reports_database_failure(monkeypatch):
    monkeypatch.setattr("common.views.check_database", lambda: False)
    response = APIClient().get("/health/")
    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "database": "unavailable"}
