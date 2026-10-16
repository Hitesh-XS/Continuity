import pytest

from accounts.models import User

pytestmark = pytest.mark.django_db
URL = "/api/v1/auth/register/"


def test_register_creates_user_and_never_returns_password(api_client, password):
    response = api_client.post(
        URL, {"email": "New@Example.com", "password": password}, format="json"
    )
    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "new@example.com"
    assert "password" not in body
    assert User.objects.get(email="new@example.com").check_password(password)


def test_register_rejects_weak_password(api_client):
    response = api_client.post(
        URL, {"email": "a@example.com", "password": "12345678"}, format="json"
    )
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert "password" in error["details"]
    assert not User.objects.filter(email="a@example.com").exists()


def test_register_rejects_duplicate_email_case_insensitively(api_client, make_user, password):
    make_user("alice@example.com")
    response = api_client.post(
        URL, {"email": "ALICE@example.com", "password": password}, format="json"
    )
    assert response.status_code == 400
    assert "email" in response.json()["error"]["details"]
    assert User.objects.count() == 1


def test_register_rejects_invalid_email(api_client, password):
    response = api_client.post(URL, {"email": "not-an-email", "password": password}, format="json")
    assert response.status_code == 400
    assert "email" in response.json()["error"]["details"]


def test_register_requires_both_fields(api_client):
    response = api_client.post(URL, {}, format="json")
    assert response.status_code == 400
    details = response.json()["error"]["details"]
    assert "email" in details
    assert "password" in details


def test_register_can_be_disabled(api_client, password, settings):
    settings.AUTH_REGISTRATION_ENABLED = False
    response = api_client.post(URL, {"email": "a@example.com", "password": password}, format="json")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "registration_disabled"
    assert User.objects.count() == 0
