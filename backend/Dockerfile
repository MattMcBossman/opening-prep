# Production image for the Mainline backend.
#
# Day-to-day development runs Django on the host via `uv run` (see README.md);
# this exists so production parity isn't deferred to some later phase.

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS base

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Dependencies are installed from the lockfile in their own layer, so editing
# application code doesn't invalidate the (slow) dependency install.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY . .
RUN uv sync --frozen --no-dev

# Collected with a throwaway key/database URL: `collectstatic` touches neither,
# but Django still insists on a valid settings module at import time.
RUN DJANGO_SECRET_KEY=build-only \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    python manage.py collectstatic --noinput

RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

# Migrations are deliberately NOT run here; run them as a separate release step
# so concurrent container starts can't race each other.
CMD ["gunicorn", "opening_prep.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3"]
