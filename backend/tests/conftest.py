import pytest
from django.core.cache import cache
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import User


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
