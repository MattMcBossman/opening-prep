# Mainline backend

Django + Django REST Framework + PostgreSQL. Provides Mainline accounts (Google
OIDC, with optional Lichess OAuth and a validated public Chess.com username), server-side repertoire storage, a caching Lichess explorer proxy, and
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

### One-time Google sign-in setup for Tailscale development

Do this while working directly on the laptop. It configures only local/Tailscale
development; do not add these values to Render yet.

1. Run `../scripts/remote-dev` and copy the HTTPS URL it prints, such as
   `https://laptop-name.example-tailnet.ts.net`.
2. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview),
   then create or select a Google Cloud project.
3. If prompted, choose **Get started** and enter:
   - App name: `Mainline`
   - User support email and contact email: the developer's email
   - Audience: **External**
4. On **Audience**, add the developer's Google account as a test user. Publishing
   or verification is not required for this private test.
5. Open **Clients**, choose **Create client**, select **Web application**, and
   name it `Mainline Tailscale Development`.
6. Add this exact **Authorized redirect URI**, substituting the URL printed by
   `remote-dev`:

   ```text
   https://<tailscale-host>/api/v1/auth/google/callback
   ```

   Mainline's server-side flow does not require an Authorized JavaScript origin.
7. Create the client and copy its client ID and client secret. Google may show
   the secret only at creation time; never paste it into chat or commit it.
8. Stop `remote-dev`, then add the values to the untracked `backend/.env`:

   ```dotenv
   GOOGLE_CLIENT_ID=<client-id>
   GOOGLE_CLIENT_SECRET=<client-secret>
   ```

9. Restart from the repository root with `./scripts/remote-dev`, open its HTTPS
   URL, and choose **Sign in → Continue with Google**.

If Google reports `redirect_uri_mismatch`, compare its URI character-for-character
with the URL above, including `https`, the callback path, and the absence of a
trailing slash. If Mainline reports `google_unavailable`, confirm both `.env`
values are populated and restart `remote-dev` so Django reloads them.

The wrapper expects ports 8000 and 5173 to be free. Do not leave a separately
started `manage.py runserver` or Vite process running before invoking it; its
preflight reports the exact conflicting listener and exits before starting a
partial stack.

## Commands

```bash
uv run manage.py runserver     # dev server on :8000
uv run manage.py migrate       # apply migrations
uv run manage.py seed_opening_templates  # legacy empty/demo-database starter content only
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
- `accounts/` — custom `User`, Google OIDC, Lichess OAuth (PKCE), and encrypted token storage. Legacy magic-link tables remain migration-only.
- `repertoire/` — reusable personal opening modules, composed profiles,
  explicit move-order lines, immutable global-opening release snapshots, and
  the FEN-graph cascade-delete semantics kept compatible with older clients.
- `explorer_cache/` — FEN-keyed public and short-lived per-user Lichess explorer caches, plus a versioned engine-eval cache populated by client-side Stockfish.
- `drills/` — drill sessions, per-attempt history, weakness aggregates.

Global opening templates are curated through Django admin or the existing
publication APIs. A published release stores immutable validated `tree` and
`lines` JSON snapshots, so profiles pin an exact version and editable copies
retain source provenance. The legacy `seed_opening_templates` command still
contains early demo releases and must not be run against a curated database;
the replacement/versioning workflow remains in
[`../ROADMAP.md`](../ROADMAP.md).

## Notes

- **Mainline sign-in** uses Google authorization-code OIDC. Production and
  private Tailscale development require their own Google Web OAuth clients.

- **Lichess OAuth** is a public-client PKCE flow: no client secret, and no scopes
  at all — the Opening Explorer only requires that a token exists. Access tokens
  are encrypted at rest and never leave the server.
- **Chess.com linking** validates and stores only a public username through the
  Published Data API. It stores no Chess.com credentials and is not ownership
  verification; Chess.com authentication requires a separate partner request.
  **My games** can filter to Lichess, Chess.com, or combine both. The backend
  streams game records; a browser Web Worker incrementally parses them into an
  IndexedDB position graph, exposes partial results during ingestion, and
  serves later positions locally without storing personal-game positions in
  PostgreSQL.
- **Docker**: the repository-root `Dockerfile` builds the combined React/Django
  Render image; `backend/Dockerfile` remains a backend-only image. Development deliberately
  runs Django on the host instead, for a faster edit/reload/debug loop; Compose
  only provides PostgreSQL.
