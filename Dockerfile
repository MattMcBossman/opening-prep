# Mainline production image. Render builds this file with the repository root
# as its context so the React and Django applications ship as one origin.
FROM node:24-bookworm-slim AS frontend

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS backend

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/ ./
COPY --from=frontend /build/frontend/dist ./frontend_dist
RUN uv sync --frozen --no-dev
RUN DJANGO_ENV=development \
    DJANGO_SECRET_KEY=build-only \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    python manage.py collectstatic --noinput

RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

# Schema migrations run as Render's pre-deploy command, never at web startup.
CMD ["sh", "-c", "gunicorn opening_prep.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 3 --access-logfile - --error-logfile -"]
