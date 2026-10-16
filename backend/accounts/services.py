from django.db import IntegrityError, transaction
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .models import User


class EmailAlreadyRegisteredError(Exception):
    """Raised when the email is already taken (including a concurrent signup race)."""


class InvalidRefreshTokenError(Exception):
    """Raised when a refresh token is malformed, expired, or already revoked."""


def register_user(*, email: str, password: str) -> User:
    """Create a user. The database constraint is the final arbiter of uniqueness,
    so two simultaneous signups with the same email cannot both succeed."""
    try:
        with transaction.atomic():
            return User.objects.create_user(email=email, password=password)
    except IntegrityError as exc:
        raise EmailAlreadyRegisteredError from exc


def revoke_refresh_token(raw_token: str) -> None:
    """Blacklist a refresh token so it can never mint new access tokens."""
    try:
        RefreshToken(raw_token).blacklist()
    except TokenError as exc:
        raise InvalidRefreshTokenError from exc
