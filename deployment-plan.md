# Deployment plan

## Status and objective

**The remote-development and mobile foundations are implemented. Current
product priority is tracked only in [ROADMAP.md](ROADMAP.md).** This document covers
three deliberately separate stages: laptop-hosted private development, a
disposable free-Render alpha for invited friends, and paid production once data
durability and predictable availability matter.

The cached analysis roadmap is in
[position-analysis-plan.md](position-analysis-plan.md). Its basic release keeps
Stockfish in the browser; paid server compute is not a deployment prerequisite.

The first target is:

- the existing development stack continues to run on the laptop;
- the phone can reach one private application origin from any network;
- access is private to the developer's Tailscale network;
- Django sessions, CSRF, Lichess OAuth, Stockfish, and saved data work through
  that origin;
- stopping the laptop or development processes is acceptable.

## Immediate hosting decision: free Tailscale Personal

Install Tailscale on both the laptop and phone and sign both into the same
tailnet. Tailscale's Personal plan is free for personal use. Use **Tailscale
Serve**, which publishes a laptop-local service at a private `*.ts.net` address
available only to devices in that tailnet. Use HTTPS so Google and Lichess OAuth callbacks satisfy their secure-origin requirements.

This requires no Render service, cloud VM, paid database, router port
forwarding, static home IP, or public exposure. PostgreSQL remains on the
laptop. Tailscale supplies private connectivity and a stable MagicDNS hostname.

Relevant references:

- [Tailscale Personal pricing](https://tailscale.com/pricing)
- [Tailscale quickstart](https://tailscale.com/docs/how-to/quickstart)
- [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)

Do not use Tailscale Funnel by default. Funnel makes the service reachable from
the public internet and is unnecessary when the phone can run Tailscale. It can
be considered later for temporary public demos.

## Implementation sequence

### H1 — One local application origin

- [x] Add a development-host command that serves React and Django through one
  browser origin while preserving Vite hot reload.
- [x] Keep PostgreSQL bound locally; never expose port 5432 through Tailscale or
  the router.
- [x] Bind both application processes to loopback; Tailscale Serve is the only
  remote ingress.
- [ ] Verify SPA refreshes, API requests, admin assets, Stockfish WASM/worker
  loading, and authenticated mutations locally.

Exit gate: one command starts an application origin on the laptop and the full
app works locally through it.

Codex verification note: the laptop PostgreSQL service is intentionally bound
to host loopback. PostgreSQL-backed commands must run outside Codex's isolated
network namespace; see `AGENTS.md` and `backend/README.md`. A sandbox-only
connection failure is not a database outage.

### H2 — Private remote access

- [x] Install Tailscale on the laptop and phone and sign both into the same free
  Personal tailnet.
- [x] Add `scripts/remote-dev`, which discovers the MagicDNS name and proxies
  Vite with `tailscale serve --bg 5173`, then health-checks the
  resulting tailnet URL before reporting success.
- [x] Preflight and name conflicts on Django port 8000 and Vite port 5173 before
  starting either server; require Vite's exact port instead of silently falling
  forward to 5174.
- [x] Complete migrations and verify Tailscale Serve authorization before
  starting background servers. Document the one-time
  `sudo tailscale set --operator="$USER"` setup so an access denial cannot leave
  a partial stack running.
- [x] Add the resulting `*.ts.net` hostname/origin to Django's allowed hosts and CSRF trusted origins.
- [x] Configure the frontend origin and OAuth redirect URIs for that hostname. Do not commit secrets or machine-specific tailnet names; Google and Lichess callbacks use the private HTTPS origin.
- [ ] At the laptop, complete the one-time Google Auth Platform client setup in
  `backend/README.md`, add the client ID/secret to the untracked `backend/.env`,
  restart `remote-dev`, and verify Google sign-in.
- [x] Document start and automatic stop behavior for the app and Tailscale
  Serve.

Exit gate: with Wi-Fi disabled, the phone loads the site over cellular while
connected to Tailscale, and a device outside the tailnet cannot load it.

### H3 — Development smoke test

- [ ] From the phone, verify sign in/out and Lichess OAuth callback behavior.
- [ ] Verify anonymous and authenticated line saves survive refresh.
- [ ] Verify explorer sources and filters, profiles/modules, global-opening
  preview/copy, PGN import/export, drills, audio, and Stockfish.
- [ ] Record obvious mobile layout blockers for the later mobile-oriented pass;
  fix only blockers that prevent meaningful remote development.
- [ ] Confirm the laptop sleeping, shutting down, losing internet, or stopping
  the app produces expected unavailability and recovers after restart.

Exit gate: the phone is a usable remote development client, and the setup is
documented well enough to repeat after a reboot.

## Required development configuration

Do not commit concrete secret values or the private tailnet hostname. Document
the following local values in the developer's untracked environment file:

| Variable | Remote-development rule |
| --- | --- |
| `DJANGO_DEBUG` | May remain `True` for this private development deployment. |
| `DJANGO_ALLOWED_HOSTS` | Include the laptop's exact Tailscale hostname. |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | Include the exact Tailscale development origin. |
| `DATABASE_URL` | Existing laptop-local PostgreSQL connection. |
| `FRONTEND_URL` | Exact Tailscale development origin. |
| `LICHESS_REDIRECT_URI` | `<tailscale-origin>/api/v1/auth/lichess/callback`. |
| `GOOGLE_CLIENT_ID` | Web OAuth client created specifically for Tailscale development. |
| `GOOGLE_CLIENT_SECRET` | Matching local client secret; never commit it or paste it into chat. |
| `TOKEN_ENCRYPTION_KEY` | Existing local Fernet key; never commit it. |

## Invited alpha — free Render services

### Purpose and expectations

Before paying for production, run a small, explicitly temporary alpha on **one
Free Render Web Service and one Free Render Postgres database**. Keep the
combined React/Django same-origin architecture and browser-side Stockfish. This
phase is for usability feedback from a few trusted friends, not durable hosting
or a public launch.

Set expectations before inviting anyone:

- the web service sleeps after 15 minutes without inbound traffic, and the next
  visit can take about a minute to wake it;
- Render may restart the service, so brief unavailability is normal;
- the free database is limited to 1 GB, has no managed backups, and expires 30
  days after creation; after its 14-day upgrade grace period, Render deletes it;
- alpha repertoire/account data is disposable unless the database is upgraded
  or exported before expiry;
- the free web instance has 512 MB RAM and substantially less CPU than Starter,
  so this phase tests product behavior, not production performance.

The client-side engine makes this viable: Stockfish consumes the user's device,
not Render CPU. A few friends performing ordinary repertoire and drill actions
should fit the free service, but cold starts and concurrent Django/API requests
will be visibly slower. Monitor Render's included instance hours, bandwidth,
build minutes, and service-initiated traffic rather than using artificial
keep-awake requests.

### Free-tier deployment changes

The `render-launch` branch's committed `render.yaml` is the reviewed alpha
definition. Restore the paid-production values described below before merging
this branch into the eventual production branch. For the free alpha:

1. Set both Blueprint plans to `free`. Keep the web service and database in the
   same region.
2. Remove `preDeployCommand`: Render only provides pre-deploy commands to paid
   web services. For the single-instance alpha only, use a small entrypoint that
   runs `python manage.py migrate --noinput` and the idempotent starter-library
   seed before starting Gunicorn. Return migrations and seeding to explicit
   release operations before upgrading to production.
3. Start with one Gunicorn worker on the free instance. Increase it only after
   observing memory and latency; three workers are the paid-instance default.
4. Keep `/api/v1/health/` as Render's database-independent health check. Verify
   `/api/v1/ready/` manually after each deploy to confirm PostgreSQL access.
5. Use the generated `onrender.com` HTTPS origin for allowed hosts, CSRF,
   frontend redirects, and the Lichess callback. A custom domain is optional in
   alpha.
6. Generate a new production-shaped `DJANGO_SECRET_KEY` and Fernet
   `TOKEN_ENCRYPTION_KEY` in Render. Never reuse laptop secrets or commit them.
7. Disable pull-request preview environments. They would create unnecessary
   services and can complicate the one-free-database limit.

Running migrations at web startup is an intentional free-tier compromise, not
the long-term release design. It is acceptable only while there is one web
instance, changes are backward-compatible, and losing alpha data is an agreed
risk.

### Alpha launch and operating checklist

- [ ] Deploy the `render-launch` branch and confirm the Docker build succeeds.
- [ ] Confirm migrations complete before Gunicorn starts and both health and
  readiness endpoints return success.
- [ ] Smoke-test SPA deep links, admin static assets, registration/OAuth,
  Chess.com username linking, CSRF-protected saves, explorer requests,
  Stockfish assets, drills, audio, and mobile layout.
- [ ] Tell invited users that the service may take about a minute to wake and
  that alpha data is not guaranteed to survive.
- [x] Publish the minimal privacy statement at `/privacy/`.
- [ ] Keep the alpha invite-only and avoid collecting data that cannot safely be
  lost. Include the privacy URL with every invitation.
- [ ] Record the database creation and expiry dates. Set reminders seven days
  before expiry and before the end of the upgrade grace period.
- [ ] Review logs and usage weekly for memory pressure, repeated 5xx responses,
  upstream 429/502 responses, bandwidth, build minutes, and database growth.
- [ ] Before the free database expires, choose one outcome: upgrade it in place,
  export the data and migrate to a paid database, or deliberately delete the
  disposable alpha and notify testers.

### Exit gate to paid production

Move to the paid topology below before promising availability or retaining
meaningful user data. Upgrade no later than the first of: approaching database
expiry, users treating repertoires as durable, cold starts disrupting testing,
free CPU/memory limiting normal use, or invitations expanding beyond a small
trusted group. After upgrading, restore pre-deploy migrations, use the paid
worker count, enable database recovery/backups, perform a restore test, and run
the full production launch gates.

## Actual production deployment

### Decision

Use **one paid Render Web Service plus one paid Render Postgres database**, in
the same Render region and workspace. Serve the compiled React application and
the Django API from the same HTTPS origin. Keep Stockfish in the browser and do
not add a worker, Redis, object store, or persistent web-service disk for the
first release.

This is the smallest production topology that preserves Mainline's existing
same-origin session/CSRF design. It also gives the application independent
uptime, managed TLS, a private database connection, health checks, pre-deploy
migrations, deploy history, and rollback without operating a VM. Render's free
web/database products are evaluation tiers, not this plan: free web services
sleep and free databases expire. Check the live price before purchase; in July
2026, Render described the smallest always-on web service plus paid PostgreSQL
as roughly **$13/month before bandwidth and storage growth**.

Authoritative references:

- [Render web services](https://render.com/docs/web-services)
- [Render deploy and pre-deploy behavior](https://render.com/docs/deploys)
- [Render Postgres](https://render.com/docs/postgresql)
- [Render custom domains and managed TLS](https://render.com/docs/custom-domains)
- [Render free-tier limitations](https://render.com/docs/free)

Do not split the frontend onto a separate static-site origin. It would require
cross-origin credentials/CORS and different cookie semantics for no useful
launch benefit. A CDN or separate frontend can be reconsidered only if measured
traffic makes it worthwhile.

### Production-enablement implementation

The repository-root `Dockerfile` and `render.yaml` now implement the combined
Render topology. The older `backend/Dockerfile` remains useful as a backend-only
image. The production implementation:

1. Uses a multi-stage root production image: run `npm ci` and `npm run build`
   in `frontend/`, retain the existing locked `uv` backend build, and copy the
   compiled frontend into the final image.
2. Serves `/api/`, `/admin/`, and Django static assets through Django/Gunicorn,
   and serves frontend assets plus an `index.html` fallback for non-API SPA
   routes. WhiteNoise is appropriate at this scale; hashed Vite assets should
   receive long immutable caching while `index.html` must not.
3. Binds Gunicorn to Render's `PORT` value, adds access/error logging to stdout,
   and keeps migrations out of the container startup command.
4. Adds proxy-aware HTTPS settings (`SECURE_PROXY_SSL_HEADER`), HSTS after the
   custom domain is verified, secure session/CSRF cookies, and an HTTPS redirect.
   Production configuration must reject an insecure/default Django secret, an
   empty token-encryption key, `DJANGO_DEBUG=True`, and incomplete canonical
   URLs. Run `manage.py check --deploy` in CI and during image validation.
5. Makes `/api/v1/health/` a liveness endpoint that does not depend on an
   upstream API. Add a separate readiness check or deployment smoke command
   that executes `SELECT 1` against PostgreSQL.
6. Adds a root `render.yaml` with explicit starter choices (`mainline`,
   `mainline-db`, Oregon). Change those choices before applying the Blueprint if
   needed. Secrets remain in Render and the database uses its private URL.

The existing data model stores no user uploads, so Render's ephemeral service
filesystem is correct. Opening-template JSON and Stockfish assets are immutable
build artifacts. Do not attach a persistent disk.

### Production configuration contract

Use one canonical value such as `https://mainline.example.com` consistently.
The temporary `*.onrender.com` hostname may be used for the first smoke test,
but OAuth should be registered against the final domain before inviting users.

| Variable | Production value/rule |
| --- | --- |
| `DJANGO_ENV` | `production`; enables fail-closed production validation and HTTPS settings. |
| `DJANGO_DEBUG` | `False`; startup fails if true. |
| `DJANGO_SECRET_KEY` | Render-generated secret, distinct from every development environment. |
| `TOKEN_ENCRYPTION_KEY` | New production Fernet key; losing it makes stored OAuth tokens unreadable. |
| `DATABASE_URL` | Render Postgres **internal** connection URL. |
| `DJANGO_ALLOWED_HOSTS` | Canonical hostname and, during bring-up only, the exact Render hostname. |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | Exact canonical HTTPS origin (plus temporary Render HTTPS origin during bring-up). |
| `FRONTEND_URL` | Exact canonical HTTPS origin. |
| `LICHESS_CLIENT_ID` | Stable production identifier, conventionally the canonical URL. |
| `LICHESS_REDIRECT_URI` | `<canonical-origin>/api/v1/auth/lichess/callback`. |
| `LICHESS_HOST` / `LICHESS_EXPLORER_URL` | Keep the documented public defaults. |

Render's `RENDER_EXTERNAL_HOSTNAME` automatically supplies the temporary host,
CSRF origin, frontend origin, and default Lichess callback during bring-up.
Explicit canonical-domain values replace those defaults later.
`REMOTE_DEV_ORIGIN` must remain unset in production. Keep all secrets in
Render's environment manager, never in `.env`, Blueprint YAML, logs, or issue
text.

### Provisioning and first release runbook

No external resources should be created until the production-enablement PR has
passed its gates below.

1. Choose the Render region nearest the expected initial users and create paid
   PostgreSQL there. Pin a currently supported PostgreSQL major version and use
   its internal URL from the web service.
2. Create the paid Docker Web Service from the protected production branch.
   Configure `/api/v1/health/` as its health-check path and enable deploys only
   after required CI checks pass.
3. Enter the production configuration above. Set the pre-deploy command to
   `python manage.py migrate --noinput`; it must finish successfully before the
   new image receives traffic. Seed global opening releases as a separate,
   explicitly run idempotent command after the first migration, not on every
   process start.
4. Deploy first to the Render hostname. Verify health, SPA deep-link refreshes,
   Django admin assets, database writes, CSRF-protected mutations, Stockfish
   worker/WASM loading, and Lichess explorer behavior. Do not invite users yet.
5. Attach the chosen custom domain, update DNS, wait for Render's managed TLS,
   replace temporary host/origin values, and register the exact production
   Lichess OAuth callback. Then test login, callback, logout, and a fresh-browser
   session on the canonical domain.
6. Run the desktop and phone launch smoke matrix: anonymous persistence, account
   migration, repertoire/profile/module CRUD, PGN import/export, coverage,
   selected-position and full drills, audio, engine analysis/cache upload, and
   upstream failure/rate-limit states.
7. Create an admin account through a one-off Render shell command. Never expose
   a default credential or automate a fixed admin password.

### CI, release, and rollback gates

Before automatic production deployment, CI must pass backend tests, frontend
unit/lint/build tests, the core Playwright suite, a production image build, and
`manage.py check --deploy` against non-secret placeholder production values.
Pin deploys to a protected branch and require CI success.

Every schema change must be backward-compatible with the currently running
application during a zero-downtime deploy. Use expand/migrate/contract across
multiple releases for destructive column/table changes. A failed pre-deploy
migration stops the release; investigate it rather than starting the new image
manually.

For an application regression, roll Render back to the preceding successful
image. A code rollback does **not** reverse a migration. Only apply a tested
forward repair migration unless a specific reversible migration and data impact
have been reviewed. Keep the prior image available until the new release has
passed smoke testing.

### Operations for the first real users

- Send application and Gunicorn logs to Render stdout and alert on repeated 5xx
  responses, failed deploys, unhealthy instances, database capacity, and
  explorer upstream 429/502 rates. Avoid logging OAuth tokens, cookies, request
  bodies, PGNs, or database URLs.
- Start with one web instance and the current three Gunicorn workers, then check
  memory and database-connection use under concurrent Stockfish clients before
  changing worker count. Stockfish CPU remains on each user's device.
- Establish a monthly spend alert and review bandwidth, build minutes, database
  storage, connections, slow queries, and cache growth.
- Before storing invited users' meaningful repertoires, enable the paid
  database's available recovery features and make an encrypted off-platform
  `pg_dump`. Before public launch, perform and time one restore into a separate
  database. Document retention and recovery-point/recovery-time objectives from
  the paid plan actually purchased.
- Publish a minimal privacy statement covering OAuth identity/token storage,
  repertoire/game-derived data, logs, deletion requests, and third-party
  Lichess/Chess.com calls before accepting users beyond the owner.

### Launch gates and unresolved owner choices

Production is ready only when all of these are true:

- [ ] Production-enablement image/settings changes pass CI and local container smoke testing.
- [ ] Paid web/database plan, region, service names, and monthly budget are approved.
- [ ] Canonical domain is selected and controlled by the owner.
- [ ] Lichess production callback works on that domain.
- [ ] Migration, seed, health/readiness, desktop, and real-phone smoke tests pass.
- [ ] Alerting and a tested database restore exist before invited-user data matters.
- [ ] Rollback owner and incident contact path are written down.
- [ ] The public-launch legal, attribution, contact, and feedback checklist below is complete.

The choices intentionally left to the owner are the domain, Render region,
monthly budget ceiling, whether the first release is owner-only or invite-only,
and the database recovery/retention tier. None requires changing the application
architecture above.

### Public-launch legal, attribution, contact, and feedback checklist

This is an engineering/product checklist, not legal advice. Have the final
documents and handling process reviewed by someone qualified for the places
where Mainline will operate before relying on them.

- [ ] Audit production dependencies, fonts, icons, board/piece artwork, copied
  text, opening-name data, generated opening modules, Stockfish, and external
  data/API terms. Record provenance and license obligations in a maintained
  `THIRD_PARTY_NOTICES` file; remove or replace anything whose reuse is unclear.
- [ ] Decide and document the license, if any, for Mainline source code and for
  Mainline-authored opening modules separately. Do not imply that user-created
  modules inherit a license unless the publishing flow says so explicitly.
- [ ] Confirm the copyright-holder name and year policy, and add a small footer
  or About/Help surface with the copyright notice plus Legal, Privacy, Contact,
  and Feedback links. Keep these accessible on mobile without adding permanent
  clutter around the chessboard.
- [ ] Perform a reasonable product-name/domain/trademark conflict review for
  “Mainline” before investing in public branding.
- [ ] Expand `/privacy/` to match actual production behavior: account/OAuth
  data, encrypted Lichess tokens, Chess.com identifiers, repertoires and
  community publications, browser storage, logs/diagnostics, subprocessors,
  retention, deletion/export requests, security contact, and cross-border
  processing where applicable. Explain required session/CSRF cookies; do not
  add a consent banner unless the deployed tracking/storage actually requires
  one.
- [ ] Publish Terms covering acceptable use, service availability, account
  termination, disclaimers, user-created module ownership/license, moderation,
  prohibited infringement, and the process for removing reported content.
- [ ] Publish attribution/source information for Lichess, Chess.com, Stockfish,
  opening-name data, and other visible third-party material where their terms
  or licenses require it. Avoid language suggesting sponsorship or endorsement.
- [ ] Establish monitored contact routes for general support, privacy/deletion,
  security reports, and copyright/takedown requests. Separate public aliases may
  forward to one private inbox initially, but define an owner and response
  process and do not expose a personal address unnecessarily.
- [ ] Add an in-app Feedback/Report a bug path with a short category, message,
  optional reply address, success receipt, abuse protection, and a link to the
  privacy notice. Include environment/app version automatically; make URL/FEN,
  browser details, logs, and screenshots explicit opt-ins. Never attach OAuth
  tokens, cookies, private PGNs, account game data, or arbitrary request bodies.
- [ ] Connect community-module “Report” actions to a moderator queue with reason,
  status, audit history, reporter acknowledgement, and curator actions to hide
  or restore a release. Document escalation and repeat-abuse handling.
- [ ] Test every footer/legal/contact/feedback route signed in and out, on phone
  and desktop, with keyboard navigation and a screen reader smoke pass. Ensure
  deletion, takedown, and security messages reach the monitored destination.

## Development-only note on backups

Backups remain unnecessary for disposable laptop development data. They are no
longer deferred for actual production: follow the production operations and
launch gates above before entrusted user data accumulates.
