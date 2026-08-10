# opening-prep backend

Django + Django REST Framework + PostgreSQL. Provides user accounts (Lichess
OAuth), server-side repertoire storage, a caching Lichess explorer proxy, and
persistent drill statistics. See [../AGENTS.md](../AGENTS.md) for the wider
project reference and [API_CONTRACT.md](API_CONTRACT.md) for the endpoints.

## Requirements

- Python 3.12+ and [uv](https://docs.astral.sh/uv/)
- PostgreSQL 16, either installed on the host or via `docker compose up -d`
  (the Compose service publishes on **5433** so it can coexist with a host
  PostgreSQL on 5432)

## Setup

Create the role and database once:

```bash
sudo -u postgres psql -c "CREATE ROLE opening_prep LOGIN PASSWORD 'devpassword' CREATEDB;"
sudo -u postgres createdb -O opening_prep opening_prep
```

`CREATEDB` matters: the test suite creates and drops its own database.

Then:

```bash
cp .env.example .env
uv run python -c "from django.core.management.utils import get_random_secret_key as g; print(g())"          # DJANGO_SECRET_KEY
uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"            # TOKEN_ENCRYPTION_KEY
uv sync
uv run manage.py migrate
uv run manage.py createsuperuser   # optional, for the admin
uv run manage.py runserver
```

The frontend's Vite dev server proxies `/api` here, so run both and browse to the
Vite URL (http://localhost:5173) rather than to Django directly — that keeps the
session cookie first-party and avoids any CORS setup.

For private access from a phone outside the home network, use
`../scripts/remote-dev` instead of starting these two servers separately. It
derives the laptop's Tailscale HTTPS origin at runtime and supplies
`REMOTE_DEV_ORIGIN`; settings add only that exact hostname to Django's host and
CSRF allowlists and use it for the OAuth callback. The value does not need to be
written to `.env`.

The wrapper expects ports 8000 and 5173 to be free. Do not leave a separately
started `manage.py runserver` or Vite process running before invoking it; its
preflight reports the exact conflicting listener and exits before starting a
partial stack.

## Commands

```bash
uv run manage.py runserver     # dev server on :8000
uv run manage.py migrate       # apply migrations
uv run manage.py seed_opening_templates  # idempotently publish starter global openings
uv run manage.py makemigrations
uv run pytest                  # tests
uv run ruff check .            # lint
uv run ruff format .           # format
uv run manage.py spectacular --file schema.yml   # dump the OpenAPI schema
```

### Note for Codex/isolated command runners

The normal `backend/.env` connects to the laptop's PostgreSQL service on
`127.0.0.1:5432`. A command runner with an isolated network namespace cannot
reach that host-loopback service even when PostgreSQL is healthy. In Codex,
PostgreSQL-backed tests and `psql` diagnostics therefore need host/escalated
execution. A sandboxed `OperationalError`, failed `systemctl`, or
`pg_lsclusters` result showing owner `nobody` is evidence of isolation, not a
reason to restart PostgreSQL. Verify the host service before diagnosing an
outage.

Interactive API docs are served at http://localhost:8000/api/v1/docs/ while the
dev server is running.

## Layout

- `opening_prep/` — project settings, root URL conf. Every app is registered in
  `INSTALLED_APPS` and included in `urls.py` from the outset, so adding an
  endpoint never means touching these shared files.
- `common/` — helpers shared across apps, notably `fen.py`, a direct port of the
  frontend's `chessUtils.ts` normalization. The two must not drift: the
  repertoire is keyed by normalized FEN on both sides of the wire.
- `accounts/` — custom `User`, Lichess OAuth (PKCE), encrypted token storage.
- `repertoire/` — reusable personal opening modules, composed profiles,
  explicit move-order lines, immutable global-opening release snapshots, and
  the FEN-graph cascade-delete semantics kept compatible with older clients.
- `explorer_cache/` — FEN-keyed Lichess explorer cache and engine-eval cache.
- `drills/` — drill sessions, per-attempt history, weakness aggregates.

Global opening templates are curated through Django admin. A published release
stores immutable `tree` and `lines` JSON snapshots, so profiles pin an exact
version and editable copies retain their source provenance. Before production
content is loaded, add a curator publishing workflow that validates both JSON
shapes; see [`../profile-modules-plan.md`](../profile-modules-plan.md).

## Notes

- **Lichess OAuth** is a public-client PKCE flow: no client secret, and no scopes
  at all — the Opening Explorer only requires that a token exists. Access tokens
  are encrypted at rest and never leave the server.
- **Docker**: `Dockerfile` builds the production image. Development deliberately
  runs Django on the host instead, for a faster edit/reload/debug loop; Compose
  only provides PostgreSQL.
