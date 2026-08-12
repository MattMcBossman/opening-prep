# Current work handoff: authentication and global opening generation

Updated August 11, 2026. This document records the current stopping point for
the two active infrastructure/content workstreams. Neither workstream should
be treated as production-accepted until the verification steps below are
complete.

## Global opening candidate generator

### Completed

- Added `generate_opening_candidate`, an offline curator command that starts
  from a legal SAN/UCI prefix and emits a variation-rich PGN plus an adjacent
  JSON review report.
- Opponent turns expand by practical Lichess frequency toward a configurable
  local coverage target, bounded by global leaf/depth, minimum-game,
  minimum-frequency, and per-position reply limits. Gaps are expected and all
  omitted moves remain visible in the report.
- Repertoire turns select the most popular eligible move. When a Stockfish
  executable is supplied, the command instead selects the most popular
  candidate within a configurable centipawn-loss window of the best evaluated
  candidate.
- Generation is deliberately separate from publication. It does not create or
  mutate an immutable `OpeningTemplateRelease`.
- Focused generation, PGN branching, leaf-budget, malformed-prefix, and
  authenticated Lichess-request tests pass. Generator-adjacent backend suites
  also pass.

See `backend/repertoire/OPENING_GENERATOR.md` for command usage.

### Current blocker

No real candidate was checked in during this pass. The worktree did not have
the original `TOKEN_ENCRYPTION_KEY`, so it could not decrypt the Lichess token
already stored in PostgreSQL. A fresh `LICHESS_SERVER_TOKEN` is sufficient for
the generator and does not require the Fernet key. Stockfish is optional and
was not installed on the host.

### Next steps

1. Put a fresh personal Lichess API token in the untracked `backend/.env` as
   `LICHESS_SERVER_TOKEN`. Restore the original Fernet key only if existing
   encrypted linked-account tokens also need to remain usable.
2. Optionally install/provide a Stockfish executable and pass its path through
   `--stockfish`; first generation can proceed from statistics alone.
3. Generate a roughly 15-leaf Fried Liver candidate as the focused-opening
   acceptance case. Review its PGN and omissions report manually.
4. Import the reviewed PGN into a personal module and publish a new immutable
   release through the curator workflow. Do not publish generator output
   automatically.
5. Generate Stonewall next, then Sicilian as the breadth/transposition stress
   case. Compare results with the existing 99-line Vienna release.
6. Replace or unpublish the one-line/two-line starter releases only after
   reviewed replacements exist. The generator has not changed the legacy seed
   command yet.

## Google and email authentication

### Completed in the main workspace

- Added verified `EmailIdentity`, `GoogleAccount`, and hashed, expiring,
  single-use `MagicLink` models plus their migration and admin visibility.
- Added email-link request/callback endpoints and Google authorization-code
  OIDC start/callback endpoints.
- Added account resolution by verified email, session serialization of email,
  and optional post-sign-in Lichess linking. Lichess cannot create or sign into
  a Mainline account; anonymous users retain the separate browser-local API
  token path for explorer requests.
- Added frontend Google/email sign-in UI, API helpers, auth-error handling, and
  responsive popover styling.
- Changed private remote development to Tailscale Serve HTTPS so Google OAuth
  callbacks use a secure origin.
- Added Render environment declarations and setup documentation for Google and
  SMTP credentials.
- Added focused backend authentication tests and updated older exact-response
  assertions for the new `email` and per-move `opening` fields.
- Made verified-email account creation tolerate concurrent first sign-ins, and
  reject Google/Lichess identity collisions with `account_conflict` instead of
  silently switching, reassigning, or failing with a database error.

### Configuration still required

1. Create a Google Web OAuth client for the Tailscale HTTPS hostname, add the
   exact `/api/v1/auth/google/callback` redirect URI, add the developer as a
   test user, and put `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in the untracked
   `backend/.env`.
2. Choose an SMTP provider, verify the sender/domain, and configure the
   `EMAIL_*` and `DEFAULT_FROM_EMAIL` values. Until then, Django's console
   backend prints magic links in the server terminal for local testing.
3. Ensure `TOKEN_ENCRYPTION_KEY` is populated with the original key before
   testing existing linked Lichess accounts. A replacement key cannot decrypt
   existing ciphertext.
4. Run migrations, restart `scripts/remote-dev`, and verify Google sign-in,
   console-email sign-in, one-time link consumption, expiry/error redirects,
   logout, Lichess linking, and repertoire persistence across refresh.

### Verification follow-ups

1. Restore a Node/npm runtime in the command environment, then run frontend
   unit tests, lint, build, and the mobile authentication flow at the Tailscale
   HTTPS origin. Backend verification is clean.
2. Exercise simultaneous callbacks under real browser/database concurrency as
   an acceptance check; row locking, uniqueness races, and replay outcomes now
   have covered safe code paths.
3. Only after local acceptance, configure the corresponding Google and SMTP
   secrets in Render and perform the production callback/delivery checks in
   `deployment-plan.md`.

## Verification at handoff

- Generator-focused tests: 4 passed.
- Generator-adjacent backend suites: 130 passed.
- Full backend suite: 198 passed after the authentication/linking hardening.
- Frontend checks could not be rerun in the consolidation environment because
  neither `node` nor `npm` is currently on `PATH`.
- Django system check, Ruff checks for generator/settings files, and Git
  whitespace validation passed.
- Live generator fetch was not completed because the stored Lichess token
  could not be decrypted without the original Fernet key.
