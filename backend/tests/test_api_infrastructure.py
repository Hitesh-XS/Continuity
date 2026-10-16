import pytest

from common.exceptions import api_exception_handler

pytestmark = pytest.mark.django_db
REGISTER = "/api/v1/auth/register/"


def test_malformed_json_returns_structured_400(api_client):
    response = api_client.post(REGISTER, "{bad json", content_type="application/json")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "parse_error"


def test_oversized_body_is_rejected_with_413(api_client, settings):
    settings.API_MAX_REQUEST_BODY_BYTES = 50
    response = api_client.post(REGISTER, "x" * 200, content_type="application/json")
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


def test_unexpected_errors_return_an_error_id_and_no_internals():
    response = api_exception_handler(RuntimeError("secret internal detail"), {})
    assert response.status_code == 500
    error = response.data["error"]
    assert error["code"] == "server_error"
    assert len(error["error_id"]) == 32
    assert "secret internal detail" not in str(response.data)
