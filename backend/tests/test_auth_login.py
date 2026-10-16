import pytest

pytestmark = pytest.mark.django_db
URL = "/api/v1/auth/token/"


def test_login_returns_access_and_refresh(api_client, make_user, password):
    make_user("alice@example.com")
    response = api_client.post(
        URL, {"email": "alice@example.com", "password": password}, format="json"
    )
    assert response.status_code == 200
    body = response.json()
    assert body["access"]
    assert body["refresh"]


def test_login_email_is_case_insensitive(api_client, make_user, password):
    make_user("alice@example.com")
    response = api_client.post(
        URL, {"email": "ALICE@Example.com", "password": password}, format="json"
    )
    assert response.status_code == 200


def test_wrong_password_and_unknown_email_look_identical(api_client, make_user, password):
    make_user("alice@example.com")
    wrong_password = api_client.post(
        URL, {"email": "alice@example.com", "password": "nope"}, format="json"
    )
    unknown_email = api_client.post(
        URL, {"email": "ghost@example.com", "password": password}, format="json"
    )
    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json()
    assert wrong_password.json()["error"]["code"] == "no_active_account"


def test_inactive_user_cannot_log_in(api_client, make_user, password):
    make_user("alice@example.com", is_active=False)
    response = api_client.post(
        URL, {"email": "alice@example.com", "password": password}, format="json"
    )
    assert response.status_code == 401


def test_login_is_throttled(api_client):
    payload = {"email": "ghost@example.com", "password": "nope"}
    for _ in range(10):
        assert api_client.post(URL, payload, format="json").status_code == 401
    response = api_client.post(URL, payload, format="json")
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "throttled"
    assert response.json()["error"]["details"]["retry_after_seconds"] >= 1
    assert response["Retry-After"]
