from .base import *  # noqa: F403
from .base import env

DEBUG = False
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS")  # required in production

SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
# Full production hardening (HSTS, proxy headers, CORS, rate limits) comes in
# Phases 11 and 13. This file is intentionally a minimal safe stub.
