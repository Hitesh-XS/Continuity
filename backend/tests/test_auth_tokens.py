import pytest

pytestmark = pytest.mark.django_db
LOGIN = "/api/v1/auth/token/"
REFRESH = "/api/v1/auth/token/refresh/"
LOGOUT = "/api/v1/auth/logout/"


def _login(api_client, email, password) -> dict:
    return api_client.post(LOGIN, {"email": email, "password": password}, format="json").json()


def test_refresh_rotates_and_revokes_the_old_refresh_token(api_client, make_user, password):
    make_user("alice@example.com")
    tokens = _login(api_client, "alice@example.com", password)

    first = api_client.post(REFRESH, {"refresh": tokens["refresh"]}, format="json")
    assert first.status_code == 200
    rotated = first.json()
    assert rotated["access"]
    assert rotated["refresh"] != tokens["refresh"]

    replay = api_client.post(REFRESH, {"refresh": tokens["refresh"]}, format="json")
    assert replay.status_code == 401


def test_refresh_rejects_garbage(api_client):
    response = api_client.post(REFRESH, {"refresh": "not-a-token"}, format="json")
    assert response.status_code == 401


def test_logout_revokes_refresh_token(api_client, make_user, password):
    make_user("alice@example.com")
    tokens = _login(api_client, "alice@example.com", password)

    assert api_client.post(LOGOUT, {"refresh": tokens["refresh"]}, format="json").status_code == 204
    after = api_client.post(REFRESH, {"refresh": tokens["refresh"]}, format="json")
    assert after.status_code == 401


def test_logout_rejects_garbage_token(api_client):
    response = api_client.post(LOGOUT, {"refresh": "not-a-token"}, format="json")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


def test_logout_requires_refresh_field(api_client):
    response = api_client.post(LOGOUT, {}, format="json")
    assert response.status_code == 400
