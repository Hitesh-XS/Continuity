import os

# Tests must not depend on a real secret being configured.
os.environ.setdefault("DJANGO_SECRET_KEY", "test-only-key-not-a-secret")

from .base import *  # noqa: E402, F403

# Fast hashing keeps the test suite quick. Never use this outside tests.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]