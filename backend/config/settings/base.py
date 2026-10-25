"""Settings shared by every environment. Environment-specific values live in
dev.py / test.py / prod.py. Secrets come from environment variables only."""

from datetime import timedelta
from pathlib import Path

import environ

# backend/ directory (settings/ -> config/ -> backend/)
BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
# Reads backend/.env if present; in production real environment variables are used.
environ.Env.read_env(BASE_DIR / ".env")

# Required: raises ImproperlyConfigured if missing (no insecure default).
SECRET_KEY = env("DJANGO_SECRET_KEY")

DEBUG = False  # off unless an environment file deliberately turns it on
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=[])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "accounts",
    "common",
    "projects",
    "ai"

]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "common.middleware.RequestBodyLimitMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {"default": env.db("DATABASE_URL")}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---- Continuity API settings -------------------------------------------------
# Self-service registration switch (roadmap: "if self-service registration is enabled").
AUTH_REGISTRATION_ENABLED = env.bool("AUTH_REGISTRATION_ENABLED", default=True)

# Reject request bodies larger than this (checked via Content-Length). A reverse
# proxy limit (e.g. nginx client_max_body_size) is still needed in production.
API_MAX_REQUEST_BODY_BYTES = env.int("API_MAX_REQUEST_BODY_BYTES", default=2 * 1024 * 1024)

# Secure-by-default API: everything requires a valid JWT unless a view says otherwise.
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "120/min",
        "user": "600/min",
        "auth_register": "20/hour",
        "auth_login": "10/min",
        "auth_refresh": "30/min",
        "ai_extract": "20/hour"
    },
    "EXCEPTION_HANDLER": "common.exceptions.api_exception_handler",
    "DEFAULT_PAGINATION_CLASS": "common.pagination.StandardPagination",

}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,  # every refresh issues a new refresh token...
    "BLACKLIST_AFTER_ROTATION": True,  # ...and revokes the one that was used
    "UPDATE_LAST_LOGIN": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# Never log message content, handoff packages, or API keys anywhere in this project.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "standard"},
    },
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
}

# ---- AI analysis (all optional; the feature is off unless fully configured) ----------------
AI_ENABLED = env.bool("AI_ENABLED", default=False)
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY", default="")
AI_MODEL = env("AI_MODEL", default="")
AI_PRICE_INPUT_PER_MTOK_USD = env("AI_PRICE_INPUT_PER_MTOK_USD", default="")
AI_PRICE_OUTPUT_PER_MTOK_USD = env("AI_PRICE_OUTPUT_PER_MTOK_USD", default="")
AI_MONTHLY_BUDGET_USD = env("AI_MONTHLY_BUDGET_USD", default="5.00")
AI_MAX_INPUT_CHARS = env.int("AI_MAX_INPUT_CHARS", default=40_000)
AI_MAX_OUTPUT_TOKENS = env.int("AI_MAX_OUTPUT_TOKENS", default=2_000)
AI_REQUEST_TIMEOUT_SECONDS = env.int("AI_REQUEST_TIMEOUT_SECONDS", default=60)
# Bump to ask every user to consent again (for example when what is sent changes).
AI_CONSENT_VERSION = 1