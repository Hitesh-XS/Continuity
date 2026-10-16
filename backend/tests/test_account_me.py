import pytest

pytestmark = pytest.mark.django_db
ME = "/api/v1/account/me/"


def test_me_requires_authentication(api_client):
    response = api_client.get(ME)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_authenticated"


def test_me_rejects_a_garbage_token(api_client):
    api_client.credentials(HTTP_AUTHORIZATION="Bearer not.a.token")
    response = api_client.get(ME)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "token_not_valid"


def test_me_returns_own_profile_without_password(make_user, client_for):
    user = make_user("alice@example.com")
    response = client_for(user).get(ME)
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(user.id)
    assert body["email"] == "alice@example.com"
    assert "password" not in body


def test_patch_updates_names_but_not_email_or_id(make_user, client_for):
    user = make_user("alice@example.com")
    response = client_for(user).patch(
        ME,
        {"first_name": "Alice", "email": "evil@example.com", "id": "x"},
        format="json",
    )
    assert response.status_code == 200
    user.refresh_from_db()
    assert user.first_name == "Alice"
    assert user.email == "alice@example.com"


def test_put_is_not_allowed(make_user, client_for):
    user = make_user("alice@example.com")
    response = client_for(user).put(ME, {"first_name": "A"}, format="json")
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "method_not_allowed"


def test_deactivated_user_loses_access_immediately(make_user, client_for):
    user = make_user("alice@example.com")
    client = client_for(user)
    assert client.get(ME).status_code == 200
    user.is_active = False
    user.save()
    assert client.get(ME).status_code == 401


def test_full_account_flow(api_client, password):
    register = api_client.post(
        "/api/v1/auth/register/", {"email": "flow@example.com", "password": password}, format="json"
    )
    assert register.status_code == 201

    tokens = api_client.post(
        "/api/v1/auth/token/", {"email": "flow@example.com", "password": password}, format="json"
    ).json()

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    me = api_client.get(ME)
    assert me.status_code == 200
    assert me.json()["email"] == "flow@example.com"

    api_client.credentials()  # drop the Authorization header
    logout = api_client.post("/api/v1/auth/logout/", {"refresh": tokens["refresh"]}, format="json")
    assert logout.status_code == 204
    refresh = api_client.post(
        "/api/v1/auth/token/refresh/", {"refresh": tokens["refresh"]}, format="json"
    )
    assert refresh.status_code == 401
