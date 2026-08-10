# Remote development hosting plan

## Status and objective

**The remote-development foundation is implemented; mobile optimization is now
the active milestone in [mobile-plan.md](mobile-plan.md).** This document remains
the operating plan for running the current application and PostgreSQL on the
developer's laptop and reaching it securely from the developer's phone without
paying for cloud hosting.

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
Serve**, which publishes a laptop-local HTTP service at a private `*.ts.net`
address available only to devices in that tailnet. Use tailnet HTTP during this
development milestone: the underlying Tailscale connection is encrypted, and
this avoids depending on public ACME certificate issuance.

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
  Vite with `tailscale serve --http=80 --bg 5173`, then health-checks the
  resulting tailnet URL before reporting success.
- [x] Preflight and name conflicts on Django port 8000 and Vite port 5173 before
  starting either server; require Vite's exact port instead of silently falling
  forward to 5174.
- [x] Complete migrations and verify Tailscale Serve authorization before
  starting background servers. Document the one-time
  `sudo tailscale set --operator="$USER"` setup so an access denial cannot leave
  a partial stack running.
- [x] Add the resulting `*.ts.net` hostname/origin to Django's allowed hosts and
  CSRF trusted origins. HTTP remote origins are accepted only with Debug mode;
  non-development configuration still requires HTTPS.
- [x] Configure the frontend origin and Lichess OAuth redirect URI for that
  hostname. Do not commit secrets or machine-specific tailnet names. Lichess
  OAuth over a non-local HTTP callback may remain unavailable until tailnet
  HTTPS certificate issuance succeeds; basic app access does not depend on it.
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
| `TOKEN_ENCRYPTION_KEY` | Existing local Fernet key; never commit it. |

## Deferred production hosting

Render is **not required or planned for the current development milestone**.
When the project is ready for other users and independent uptime, revisit a
managed deployment. The previously evaluated Render shape was a paid Starter
Web Service plus a separate smallest paid persistent Render Postgres database;
those payments buy always-on compute and a database that does not depend on the
developer's laptop. Re-evaluate Render and alternatives at that time instead of
committing to them now.

Future production work includes a production image, fail-closed settings,
health checks, CI/CD, managed secrets, migrations, monitoring, rollback, a
canonical domain, and a narrow-screen launch smoke test.

## Way-back-burner — PostgreSQL backups and disaster recovery

Backups, point-in-time recovery policy, off-platform logical exports, and
restore drills are explicitly not requirements for remote development or the
first production experiment. Revisit them when the application holds meaningful
user data, before charging for the service, or when the owner promotes this
item.
