import pytest
from django.core.cache import cache
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import User
from projects.models import Checkpoint, Project


@pytest.fixture(autouse=True)
def _clear_cache():
    """Throttle counters live in the cache; isolate every test from the others."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def password() -> str:
    return "correct-horse-battery-9"


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def make_user(db, password):
    def _make(email: str = "alice@example.com", **kwargs) -> User:
        return User.objects.create_user(email=email, password=password, **kwargs)

    return _make


@pytest.fixture
def client_for():
    """An APIClient authenticated as the given user (no login request involved)."""

    def _client_for(user: User) -> APIClient:
        client = APIClient()
        token = RefreshToken.for_user(user).access_token
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return client

    return _client_for


@pytest.fixture
def alice(make_user) -> User:
    return make_user("alice@example.com")


@pytest.fixture
def bob(make_user) -> User:
    return make_user("bob@example.com")


@pytest.fixture
def make_project(db):
    def _make(owner: User, **kwargs) -> Project:
        kwargs.setdefault("name", "Test project")
        return Project.objects.create(owner=owner, **kwargs)

    return _make


@pytest.fixture
def make_checkpoint(db):
    """Create a checkpoint directly in the database (bypasses the API rules)."""

    def _make(project: Project, **overrides) -> Checkpoint:
        fields = {
            "reason": "manual",
            "objective": "Finish the task",
            "state_snapshot": {"schemaVersion": 1, "nextAction": "Run the tests"},
        }
        fields.update(overrides)
        version = project.checkpoints.count() + 1
        return Checkpoint.objects.create(
            project=project, version=version, created_by=project.owner, **fields
        )

    return _make


@pytest.fixture
def ai_on(settings):
    """A fully configured, enabled AI feature with test prices ($1 in, $5 out per million tokens)."""
    settings.AI_ENABLED = True
    settings.ANTHROPIC_API_KEY = "test-key-not-real"
    settings.AI_MODEL = "test-model"
    settings.AI_PRICE_INPUT_PER_MTOK_USD = "1.00"
    settings.AI_PRICE_OUTPUT_PER_MTOK_USD = "5.00"
    settings.AI_MONTHLY_BUDGET_USD = "5.00"
    settings.AI_MAX_INPUT_CHARS = 40_000
    settings.AI_MAX_OUTPUT_TOKENS = 2_000
    settings.AI_REQUEST_TIMEOUT_SECONDS = 30
    return settings


@pytest.fixture
def give_consent(db):
    from ai.models import AIConsent

    def _give(user, version: int = 1):
        return AIConsent.objects.update_or_create(user=user, defaults={"version": version})[0]

    return _give
