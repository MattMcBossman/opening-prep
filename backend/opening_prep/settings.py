"""
Django settings for the Mainline backend.

Configuration comes from the environment (see `.env.example`), read via
django-environ. Day-to-day development runs this on the host against a local or
Compose-managed PostgreSQL; `Dockerfile` builds the same code for production.
"""

from pathlib import Path
from urllib.parse import urlparse

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DJANGO_ENV=(str, "development"),
    DJANGO_DEBUG=(bool, False),
    DJANGO_ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    DJANGO_CSRF_TRUSTED_ORIGINS=(list, ["http://localhost:5173"]),
    FRONTEND_URL=(str, "http://localhost:5173"),
    REMOTE_DEV_ORIGIN=(str, ""),
    LICHESS_HOST=(str, "https://lichess.org"),
    LICHESS_EXPLORER_URL=(str, "https://explorer.lichess.org/lichess"),
    LICHESS_CLIENT_ID=(str, "opening-prep-local"),
    CHESS_COM_API_URL=(str, "https://api.chess.com/pub"),
    CHESS_COM_USER_AGENT=(str, "Mainline/0.1 (opening repertoire app)"),
    EXPLORER_CACHE_TTL_SECONDS=(int, 60 * 60 * 24),
    PLAYER_EXPLORER_CACHE_TTL_SECONDS=(int, 60 * 10),
)

# Read backend/.env when present. Deployments may instead inject real env vars.
env_file = BASE_DIR / ".env"
if env_file.exists():
    env.read_env(env_file)

SECRET_KEY = env("DJANGO_SECRET_KEY", default="dev-only-insecure-secret-key")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS")
ENVIRONMENT = env("DJANGO_ENV").lower()

if ENVIRONMENT == "production":
    if DEBUG:
        raise ValueError("DJANGO_DEBUG must be False in production")
    if SECRET_KEY == "dev-only-insecure-secret-key" or len(SECRET_KEY) < 32:
        raise ValueError("DJANGO_SECRET_KEY must be a strong, non-default production secret")

# Render supplies this automatically. Adding it here lets the first deployment
# work on its temporary onrender.com hostname without hard-coding a service
# name into the image or Blueprint.
RENDER_EXTERNAL_HOSTNAME = env("RENDER_EXTERNAL_HOSTNAME", default="").strip()
RENDER_ORIGIN = f"https://{RENDER_EXTERNAL_HOSTNAME}" if RENDER_EXTERNAL_HOSTNAME else ""
if RENDER_EXTERNAL_HOSTNAME:
    ALLOWED_HOSTS = [*ALLOWED_HOSTS, RENDER_EXTERNAL_HOSTNAME]

# `scripts/remote-dev` sets one HTTPS Tailscale origin for the lifetime of a
# remote-development session. Keeping this additive preserves the usual
# localhost workflow and avoids committing a machine-specific tailnet name.
REMOTE_DEV_ORIGIN = env("REMOTE_DEV_ORIGIN").rstrip("/")
if REMOTE_DEV_ORIGIN:
    remote_dev_url = urlparse(REMOTE_DEV_ORIGIN)
    allowed_remote_schemes = {"https", "http"} if DEBUG else {"https"}
    if remote_dev_url.scheme not in allowed_remote_schemes or not remote_dev_url.hostname:
        raise ValueError("REMOTE_DEV_ORIGIN must be a complete origin (HTTPS unless DJANGO_DEBUG=True)")
    ALLOWED_HOSTS = [*ALLOWED_HOSTS, remote_dev_url.hostname]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    # Project apps. All four are registered up front, before any of them have
    # models, so that work on them can proceed in parallel without every change
    # touching this shared file.
    "accounts",
    "repertoire",
    "explorer_cache",
    "drills",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "opening_prep.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
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

WSGI_APPLICATION = "opening_prep.wsgi.application"

DATABASES = {
    "default": env.db_url(
        "DATABASE_URL",
        default="postgres://opening_prep:devpassword@localhost:5432/opening_prep",
    )
}

# Set from the very first migration onwards: swapping the user model in later is
# a painful, migration-rewriting exercise.
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
STATIC_ROOT = BASE_DIR / "staticfiles"
FRONTEND_DIST_DIR = BASE_DIR / "frontend_dist"
WHITENOISE_ROOT = FRONTEND_DIST_DIR
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Session / CSRF -------------------------------------------------------
# The SPA authenticates with a session cookie rather than a bearer token, so the
# Lichess access token never reaches the browser. In development Vite proxies
# `/api` to this server (see frontend/vite.config.ts), which keeps the cookie
# first-party and means no CORS configuration is needed at all.
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False  # the SPA reads it to send the X-CSRFToken header
CSRF_COOKIE_SECURE = not DEBUG
CSRF_TRUSTED_ORIGINS = env("DJANGO_CSRF_TRUSTED_ORIGINS")
if REMOTE_DEV_ORIGIN:
    CSRF_TRUSTED_ORIGINS = [*CSRF_TRUSTED_ORIGINS, REMOTE_DEV_ORIGIN]
if RENDER_EXTERNAL_HOSTNAME:
    CSRF_TRUSTED_ORIGINS = [
        *CSRF_TRUSTED_ORIGINS,
        f"https://{RENDER_EXTERNAL_HOSTNAME}",
    ]

if ENVIRONMENT == "production":
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = True
    SECURE_HSTS_SECONDS = env.int("DJANGO_SECURE_HSTS_SECONDS", default=0)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_SECONDS > 0
    SECURE_HSTS_PRELOAD = False
    X_FRAME_OPTIONS = "DENY"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    # Authenticated by default; endpoints that are usable anonymously (the
    # explorer proxy) opt out explicitly.
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_RATES": {
        # Guards the Lichess proxy so one client can't burn the shared upstream
        # rate limit for everyone.
        "explorer": "120/min",
        # Browser-computed MultiPV uploads are comparatively large and create
        # globally shared cache rows. Reads share this scope to cap automated
        # position-key enumeration as well as writes.
        "position_analysis": "30/min",
    },
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Mainline API",
    "DESCRIPTION": "Accounts, repertoire storage, explorer caching, and drill statistics.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": "/api/v1",
}

# Structured cache events make hit/miss/upstream-fetch rates measurable from
# ordinary development or production logs without adding a database write to
# every cache read. See explorer_cache.metrics.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {
        "opening_prep.cache": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        }
    },
}

# --- Lichess integration --------------------------------------------------
# Lichess is a public OAuth client: there is no client secret, `LICHESS_CLIENT_ID`
# is just an identifying string (conventionally the app URL), and the Opening
# Explorer needs no scopes at all - only that a token exists.
LICHESS_HOST = env("LICHESS_HOST")
LICHESS_EXPLORER_URL = env("LICHESS_EXPLORER_URL")
LICHESS_CLIENT_ID = env(
    "LICHESS_CLIENT_ID",
    default=RENDER_ORIGIN or "opening-prep-local",
)
CHESS_COM_API_URL = env("CHESS_COM_API_URL")
CHESS_COM_USER_AGENT = env("CHESS_COM_USER_AGENT")
LICHESS_REDIRECT_URI = (
    f"{REMOTE_DEV_ORIGIN}/api/v1/auth/lichess/callback"
    if REMOTE_DEV_ORIGIN
    else env(
        "LICHESS_REDIRECT_URI",
        default=f"{RENDER_ORIGIN or 'http://localhost:5173'}/api/v1/auth/lichess/callback",
    )
)
FRONTEND_URL = REMOTE_DEV_ORIGIN or env(
    "FRONTEND_URL",
    default=RENDER_ORIGIN or "http://localhost:5173",
)

GOOGLE_CLIENT_ID = env("GOOGLE_CLIENT_ID", default="")
GOOGLE_CLIENT_SECRET = env("GOOGLE_CLIENT_SECRET", default="")
GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GOOGLE_REDIRECT_URI = (
    f"{REMOTE_DEV_ORIGIN}/api/v1/auth/google/callback"
    if REMOTE_DEV_ORIGIN
    else env(
        "GOOGLE_REDIRECT_URI",
        default=f"{RENDER_ORIGIN or 'http://localhost:5173'}/api/v1/auth/google/callback",
    )
)
# Fernet key used to encrypt stored Lichess access tokens at rest. Generate with:
#   uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
TOKEN_ENCRYPTION_KEY = env("TOKEN_ENCRYPTION_KEY", default="")

if ENVIRONMENT == "production":
    production_origin = urlparse(FRONTEND_URL)
    if production_origin.scheme != "https" or not production_origin.hostname:
        raise ValueError("FRONTEND_URL must be a complete HTTPS origin in production")
    redirect_uri = urlparse(LICHESS_REDIRECT_URI)
    if redirect_uri.scheme != "https" or not redirect_uri.hostname:
        raise ValueError("LICHESS_REDIRECT_URI must be an HTTPS URL in production")
    if not TOKEN_ENCRYPTION_KEY:
        raise ValueError("TOKEN_ENCRYPTION_KEY is required in production")

EXPLORER_CACHE_TTL_SECONDS = env("EXPLORER_CACHE_TTL_SECONDS")
PLAYER_EXPLORER_CACHE_TTL_SECONDS = env("PLAYER_EXPLORER_CACHE_TTL_SECONDS")
