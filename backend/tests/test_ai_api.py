import pytest
from ai_helpers import FakeProvider, memory_item, msgs, reply

from ai.providers.base import ProviderError

pytestmark = pytest.mark.django_db
STATUS = "/api/v1/ai/status/"
CONSENT = "/api/v1/ai/consent/"
EXTRACT = "/api/v1/ai/extract-memory/"


@pytest.fixture
def fake(monkeypatch):
    provider = FakeProvider(reply([memory_item()]), repeat=True)
    monkeypatch.setattr("ai.services.build_provider", lambda config: provider)
    monkeypatch.setattr("ai.services.time.sleep", lambda seconds: None)
    return provider


def post(client, messages):
    return client.post(EXTRACT, {"messages": messages}, format="json")


class TestStatus:
    def test_requires_authentication(self, api_client):
        assert api_client.get(STATUS).status_code == 401

    def test_reports_disabled_when_not_configured(self, alice, client_for):
        body = client_for(alice).get(STATUS).json()
        assert body["enabled"] is False
        assert body["model"] is None
        assert body["consented"] is False

    def test_reports_the_configuration_and_budget(self, ai_on, alice, client_for):
        body = client_for(alice).get(STATUS).json()
        assert body == {
            "enabled": True,
            "provider": "anthropic",
            "model": "test-model",
            "consent_version": 1,
            "consented": False,
            "monthly_budget_usd": "5.000000",
            "spent_usd": "0.000000",
            "remaining_usd": "5.000000",
        }


class TestConsent:
    def test_requires_authentication(self, api_client):
        assert api_client.post(CONSENT, {"version": 1}, format="json").status_code == 401

    def test_grant_then_revoke(self, alice, client_for):
        client = client_for(alice)
        assert client.post(CONSENT, {"version": 1}, format="json").json() == {
            "consented": True,
            "version": 1,
        }
        assert client.get(STATUS).json()["consented"] is True
        assert client.delete(CONSENT).status_code == 204
        assert client.get(STATUS).json()["consented"] is False

    def test_granting_twice_is_fine(self, alice, client_for):
        client = client_for(alice)
        assert client.post(CONSENT, {"version": 1}, format="json").status_code == 200
        assert client.post(CONSENT, {"version": 1}, format="json").status_code == 200

    @pytest.mark.parametrize("body", [{"version": 99}, {}, {"version": "x"}])
    def test_rejects_an_unknown_version(self, alice, client_for, body):
        response = client_for(alice).post(CONSENT, body, format="json")
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "validation_error"

    def test_is_per_user(self, alice, bob, client_for):
        client_for(alice).post(CONSENT, {"version": 1}, format="json")
        assert client_for(bob).get(STATUS).json()["consented"] is False

    def test_revoking_blocks_extraction(self, ai_on, alice, client_for, fake):
        client = client_for(alice)
        client.post(CONSENT, {"version": 1}, format="json")
        assert post(client, msgs("hi")).status_code == 200
        client.delete(CONSENT)
        assert post(client, msgs("hi")).status_code == 403


class TestExtract:
    def test_requires_authentication(self, api_client, ai_on, fake):
        assert post(api_client, msgs("hi")).status_code == 401
        assert fake.calls == []

    def test_503_when_the_feature_is_off(self, alice, client_for):
        response = post(client_for(alice), msgs("hi"))
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "ai_disabled"

    def test_403_without_consent(self, ai_on, alice, client_for, fake):
        response = post(client_for(alice), msgs("hi"))
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "ai_consent_required"
        assert fake.calls == []

    def test_returns_suggestions_usage_and_redactions(
        self, ai_on, alice, give_consent, client_for, fake
    ):
        give_consent(alice)
        response = post(client_for(alice), msgs("We use JWT for auth"))
        assert response.status_code == 200
        body = response.json()
        assert body["items"] == [
            {"kind": "fact", "text": "The API uses JWT", "topic": "auth", "evidence_ids": ["m1"]}
        ]
        assert body["usage"] == {"input_tokens": 1000, "output_tokens": 200, "cost_usd": "0.002000"}
        assert body["redactions"] == {"total": 0, "by_kind": {}}
        assert body["dropped"] == {"unsupported": 0, "invalid": 0}
        assert isinstance(body["request_id"], str)

    def test_spend_shows_up_in_status(self, ai_on, alice, give_consent, client_for, fake):
        give_consent(alice)
        client = client_for(alice)
        post(client, msgs("hi"))
        assert client.get(STATUS).json()["spent_usd"] == "0.002000"

    @pytest.mark.parametrize(
        "body",
        [
            {},
            {"messages": []},
            {"messages": [{"id": "a", "role": "user", "text": "x"}] * 2},
            {"messages": [{"id": "a b", "role": "user", "text": "x"}]},
            {"messages": [{"id": "a", "role": "robot", "text": "x"}]},
            {"messages": [{"id": "a", "role": "user", "text": "   "}]},
            {"messages": [{"id": "a", "role": "user", "text": "x" * 20_001}]},
            {"messages": [{"id": "a", "role": "user"}]},
            {"messages": "nope"},
        ],
        ids=[
            "empty",
            "no-messages",
            "duplicate-ids",
            "bad-id",
            "bad-role",
            "blank-text",
            "too-long",
            "no-text",
            "not-a-list",
        ],
    )
    def test_rejects_invalid_requests(self, ai_on, alice, give_consent, client_for, fake, body):
        give_consent(alice)
        response = client_for(alice).post(EXTRACT, body, format="json")
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "validation_error"
        assert fake.calls == []

    def test_rejects_more_than_sixty_messages(self, ai_on, alice, give_consent, client_for, fake):
        give_consent(alice)
        many = [{"id": f"m{i}", "role": "user", "text": "x"} for i in range(61)]
        assert post(client_for(alice), many).status_code == 400

    def test_input_over_the_size_limit_is_413(self, ai_on, alice, give_consent, client_for, fake):
        give_consent(alice)
        ai_on.AI_MAX_INPUT_CHARS = 20
        response = post(client_for(alice), msgs("x" * 30))
        assert response.status_code == 413
        assert response.json()["error"]["code"] == "ai_input_too_large"

    def test_provider_failures_become_clean_errors_without_content(
        self, ai_on, alice, give_consent, client_for, monkeypatch
    ):
        give_consent(alice)
        failing = FakeProvider(*[ProviderError("unavailable", "down", retryable=True)] * 2)
        monkeypatch.setattr("ai.services.build_provider", lambda config: failing)
        monkeypatch.setattr("ai.services.time.sleep", lambda seconds: None)
        response = post(client_for(alice), msgs("PRIVATE-WORDS-4321"))
        assert response.status_code == 502
        assert response.json()["error"]["code"] == "ai_provider_error"
        assert "PRIVATE-WORDS-4321" not in response.content.decode()

    def test_the_budget_blocks_requests(self, ai_on, alice, give_consent, client_for, fake):
        give_consent(alice)
        ai_on.AI_MONTHLY_BUDGET_USD = "0.0001"
        response = post(client_for(alice), msgs("hi"))
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "ai_budget_exceeded"
        assert fake.calls == []

    def test_is_rate_limited(self, ai_on, alice, give_consent, client_for, fake):
        give_consent(alice)
        client = client_for(alice)
        for _ in range(20):
            assert post(client, msgs("hi")).status_code == 200
        response = post(client, msgs("hi"))
        assert response.status_code == 429
        assert response.json()["error"]["code"] == "throttled"
