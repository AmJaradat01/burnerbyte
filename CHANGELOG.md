# Changelog

## v1.1.1 (June 2026) — Honor BB_CONFIG_PATH on load

### Fixed
- **`config.Load` now reads `BB_CONFIG_PATH`.** The first-run installer writes its `config.yaml` to `BB_CONFIG_PATH` (default `./config.yaml`), but `Load` only searched `.` and `/etc/burnerbyte`, so a custom `BB_CONFIG_PATH` produced a file the next boot never read, leaving the database unconfigured and looping back into the installer. `Load` now uses the explicit file when `BB_CONFIG_PATH` is set (and tolerates it not existing yet on first boot). This also lets operators point at a config file in any location. A round-trip test (installer write to `BB_CONFIG_PATH`, then `config.Load`) guards it.

## v1.1.0 (June 2026) — First-run web installer

Completes the infrastructure-setup work. The database and Redis are hard bootstrap dependencies (the app, and its own setup state, cannot run without them), so they cannot be configured from the in-app setup wizard. This adds the missing piece: a guarded, two-phase boot that configures them from a browser.

### Added
- **First-run web installer (`internal/installer`).** When the API binary starts with no database configured (`DATABASE_URL` unset and no `config.yaml`), it boots into a token-gated installer instead of exiting. It collects the database URL, Redis URL, JWT secret, and optional encryption key; verifies the connections; writes `config.yaml` (0600, secrets included); and re-execs into normal boot (falling back to a clean exit so a restart-policy supervisor starts a fresh, configured process).
- The installer serves a self-contained page (no framework, since nothing else is up yet) with connection testing and one-click secret generation. The write target is `./config.yaml`, overridable with `BB_CONFIG_PATH`.

### Security
- Every installer endpoint is gated by a 256-bit one-time token printed to the server logs (constant-time comparison). An already-configured instance never enters installer mode, so the installer can never repoint a live deployment's datastore. Docker and systemd deployments set `DATABASE_URL` in the environment and skip the installer entirely.

### Notes
- This closes the infrastructure-setup track: read-only health (v1.0.7), runtime mailer editor (v1.0.8), runtime storage editor with cross-process hot-reload (v1.0.9), and now the first-run installer. Database and Redis connection settings remain file/env-based by design; everything else is editable at runtime from the admin UI.

## v1.0.9 (June 2026) — Runtime storage editor with cross-process hot-reload

Object storage (S3/MinIO) can now be edited from the admin UI after setup, and the change is applied live in every process.

### Added
- **`GET` / `PUT /admin/config/storage` and `POST /admin/infra/test-storage` (system admin).** Edit the endpoint, access key, secret key, and TLS at runtime. On save the new config is **verified (connect + bucket) before it is persisted**, so bad credentials are rejected without disturbing the running backend.
- **Cross-process hot-reload.** A new hot-swappable `storage.Manager` wraps the object-storage backend; on save, a reload is broadcast over Redis (`internal/cfgsync`) and **both the API and the SMTP ingest server rebuild their clients live**, so incoming-mail attachments keep landing where the API serves them from. No restart needed.
- An **Object storage (S3/MinIO)** editor in Settings → System, beside the mailer editor and health panel.

### Fixed
- **Storage credentials saved during setup now load at boot.** `config.MinIOConfig` had no JSON tags, so `LoadFromDB`'s unmarshal silently dropped `access_key` / `secret_key` / `use_ssl` (the underscore keys did not case-fold to the Go field names). DB-stored storage configured via the setup wizard loaded with empty credentials, breaking S3 auth. Added the matching JSON tags.
- **The stored `storage` config is now encrypted at rest.** `storage` was missing from the `system_config` encrypted-key set, so the S3 secret key was stored in plaintext; it is now encrypted (backward-compatible with existing plaintext rows).

### Notes
- The bucket is read-only at runtime (changing it would strand existing attachments); set it via `BB_MINIO_BUCKET` at deploy time. DB and Redis connection settings remain env/config-only. Remaining from the infrastructure-setup plan: the guarded first-run web installer.

## v1.0.8 (June 2026) — Runtime mailer editor with hot-reload

Outbound SMTP can now be changed after setup, from the admin UI, and the change takes effect immediately.

### Added
- **`GET` / `PUT /admin/config/mailer` (system admin).** Edit host, port, username, password, from-address, and TLS at runtime. Saving persists to the database (password encrypted at rest via the existing `system_config` encryptor) and **hot-reloads the live mailer through `Mailer.Reconfigure`, so no restart is needed**. The mailer is the only sender in the system (the SMTP ingest server receives, it does not send), so there is no cross-process reload to coordinate.
- An **Email (SMTP)** editor in Settings → System: load, edit, save, and test in one place, beside the existing service-health panel.

### Changed
- The password is never returned by the API; `GET` exposes only `has_password`, and an empty password on `PUT` preserves the stored secret.
- `POST /admin/infra/test-smtp` now tests the live mailer config (`Mailer.Config()`), so it reflects unsaved-then-saved edits rather than only the boot-time value.

### Notes
- Storage (S3/MinIO) is next: it is written by both the API and the SMTP ingest server, so its runtime editor needs a cross-process reload signal (and `storage` should be added to the encrypted-config key set, which it is not yet). DB and Redis remain env/config-only by design. See the infrastructure-setup plan.

## v1.0.7 (June 2026) — Post-setup SMTP connection test

First slice of the infrastructure-setup work. The admin System tab already shows live Postgres/Redis/MinIO health; this adds the one missing piece, verifying outbound email after setup.

### Added
- **`POST /admin/infra/test-smtp` (system admin).** Opens a connection to the currently configured mailer (authenticating if credentials are set) and reports success, a message, and the round-trip time. It does not send an email. Surfaced as an "Email delivery → Test connection" action in Settings → System, alongside the existing service-health panel.
- Unlike the setup wizard's test (which is unauthenticated and refuses private IPs to prevent SSRF), the admin test dials directly: a system admin is trusted and may legitimately point the mailer at an internal relay. The shared `smtpDialTest` helper is now used by both paths.

### Notes
- This is the read-only / verification half of the infrastructure-setup discussion. Still planned: a runtime editor + hot-reload for storage and SMTP config (today they are set once during setup and loaded at boot), and a guarded first-run web installer for the DB/Redis bootstrap. DB and Redis connection settings remain env/config-only by design (they are required before the app, and the wizard's own state, can exist).

## v1.0.6 (June 2026) — Docker stack made runnable

Audited the container setup end to end and fixed the issues that prevented `docker compose up` from working on a clean checkout. The Jenkins (binary + systemd) deploy path is unaffected.

### Fixed
- **Image build no longer fails on `COPY config.yaml`.** That file is gitignored and absent on a clean checkout, so every image build broke. Removed from the API, SMTP, and `Dockerfile.smtpd` images; the binaries boot from environment variables (every key has had a registered default since v1.0.3). Mount a file at `/etc/burnerbyte/config.yaml` to override via file instead.
- **API boots under compose.** The compose `JWT_SECRET` default was 23 characters; the API refuses to start below 32, so a clean `docker compose up` crash-looped. The dev default is now a clearly-insecure 46-character placeholder.
- **Schema is now migrated.** Compose had no migration step, so the API ran against an empty database. Added a one-shot `migrate` service (pinned `migrate/migrate:v4.18.3`, the version the deploy scripts use); the API and SMTP server wait for it via `service_completed_successfully`. `up` is idempotent, so re-running the stack is safe.

### Changed
- **API healthcheck** on `/healthz`; the frontend now waits for the API to be healthy before starting.
- **`ENCRYPTION_KEY` is passed through** to the API and SMTP services (previously absent, so SSO/SMTP/storage secrets were always stored in plaintext under Docker). Unified on the unprefixed `ENCRYPTION_KEY` var in `.env.example`.
- **`NEXT_PUBLIC_*` are now frontend build args.** They are inlined into the client bundle at build time, so the previous runtime `environment:` entry had no effect; `API_BASE_URL` / `WS_BASE_URL` / `FRONTEND_URL` now flow through `build.args`.
- **Docs and tooling.** README split into "full stack in Docker" and "local development" paths; added a `make docker-infra` target (infra only); documented `REDIS_PASSWORD`, `SMTP_HOSTNAME`, `WS_BASE_URL`, and `SMTPD_PORT=25` (real inbound mail) in `.env.example`.

### Notes
- The MinIO bucket is auto-created by the app on first boot; the MinIO healthcheck (`mc ready local`) is MinIO's official probe. Base image tags, the `migrate/migrate` tag, and `CGO_ENABLED=0` builds were all verified. Custom-domain deployments still need CORS/WS origins and TLS configured manually.

## v1.0.5 (June 2026) — Onboarding team step fix

### Fixed
- **Onboarding wizard: team creation + domain assignment.** The `POST /orgs/:id/teams` response is wrapped as `{ "team": ... }`, but the wizard read the team ID off the wrapper. The ID came back `undefined`, so the follow-up domain assignment called `/teams/undefined/domains` and failed with a 400, breaking the team step of first-run setup. The client now reads `res.team`. The sibling steps (organization, domain, inbox) return flat objects and were already correct.

## v1.0.4 (June 2026) — Landing motion layer

A restrained, token-based motion pass over the public landing and `/try` surfaces (the marketing surfaces governed by the vendored design-audit skill). The product app UI is unchanged.

### Changed
- **Entrance and scroll-reveal motion.** Above-the-fold hero content now rises in on load with a short stagger; the lifecycle, capabilities, ownership, and closing-CTA sections reveal as they scroll into view. Implemented purely in CSS (an on-load keyframe plus `animation-timeline: view()` for the scroll reveals), so there is no JavaScript scroll listener, no added dependency, no flash of hidden content, and unsupported browsers simply render the static layout.
- **Tactile interaction states.** Primary CTAs press down on `:active` and their arrow nudges right on hover; lifecycle cells and capability rows tint on hover, with capability icons lighting to the brand accent. The deploy terminal in the ownership section gains a blinking cursor.
- **Depth.** A faint dotted datasheet backdrop behind the hero (tinted to the foreground token and masked to fade out) and a subtle brand-tinted veil behind the closing CTA, both well under the accent budget.
- **Accessibility.** Every animation is gated on `prefers-reduced-motion: no-preference` and collapses to the static, fully visible layout under reduced motion. Colors stay on the OKLCH design tokens; no hardcoded values were introduced.

## v1.0.3 (June 2026) — Env-only configuration defaults

Completes the 12-factor boot story started in v1.0.2. Every operational config key now has a sane default registered in code, so the binary runs correctly with secrets in the environment and **no `config.yaml`**, and every `BB_*` override actually applies.

### Fixed
- **JWT lifetimes default to sane values.** Without a config file, `jwt.access_ttl` / `jwt.refresh_ttl` unmarshalled to `0`: login returned `200` with `expires_in: 0` and an access token whose `exp` equalled `iat`, so every subsequent authenticated request was rejected as expired, and the refresh cookie was a session cookie with no `Max-Age`. They now default to `15m` / `168h`.
- **Inbox limits and TTLs default correctly.** `defaults.*` keys (`default_inbox_ttl`, `max_inbox_ttl`, `max_inboxes_per_domain`, `max_domains`, `max_teams`, attachment size, reset/invite/presigned/webhook/analytics TTLs) were `0` in env-only mode, where `0` means "block all inbox creation," not "use the documented value." They now mirror `config.example.yaml`.
- **Security policies on by default.** `password_policy.*`, `lockout.*`, and `rate_limit.*` now default to the documented hardened values (8-char policy with all character classes, 5-attempt lockout for 15m, rate limiting enabled) instead of permissive zero values.
- **Server timeouts, CORS, logging, and metrics** all carry their documented defaults rather than zero/empty.

### Why
viper's `AutomaticEnv` + `Unmarshal` only populates a nested key it already knows about (via `SetDefault`, a config file, or `BindEnv`). An unregistered nested key is silently left at its zero value and its `BB_*` override is ignored. Registering the full default set fixes both the zero-value behavior and env-override pickup.

### Tests
- `TestEnvOnlyDefaults` guards the env-only path: asserts JWT TTLs are non-zero with refresh outlasting access, inbox limits are usable, and policy/server/worker defaults are populated.

## v1.0.2 (June 2026) — Env-only boot

### Fixed
- Boot from an env-only configuration: registered defaults for the database connection pool (`max_open_conns`/`max_idle_conns`/`conn_max_lifetime`) so the pool no longer fails to build at `MaxSize=0`, and for the background-worker intervals so workers no longer log "invalid interval, skipping" and stop.
- `make run-api` / `make run-smtp` now source a local `.env` before `go run`, so `cp .env.example .env` is enough to run the stack locally (the binary itself never auto-loads `.env`).

## v1.0.1 (June 2026) — Landing polish

### Changed
- Reworked the public landing page against an anti-slop design audit: full-height hero on `100dvh`, a focused two-action hero (instead of three), and copy with no em dashes across the rendered UI and i18n catalog.
- Vendored the design-audit skill into the repo (`.agents/skills/taste-skill/`, tracked in `skills-lock.json`) so the landing/marketing surfaces have a repeatable review pass.

## v1.0.0 (June 2026) — First stable release

BurnerByte reaches 1.0: a self-hosted, multi-team temporary email platform that an enterprise security team can adopt and defend. This release consolidates the platform and hardens the core.

### Platform
- Multi-org, multi-team, multi-domain with dynamic RBAC (org owner/admin/member, team lead/member) and per-assignment, per-domain, per-team settings cascades.
- SSO (OIDC/OAuth) with domain-mapping auto-provisioning, invite-only mode with per-invite allowed auth methods, and bulk invites with multi-team assignment.
- Auth lifecycle: per-user auth-method lock, admin-driven migration between password and SSO, and session binding that revokes mismatched sessions on refresh.
- Disposable inboxes with a TTL cascade, real-time delivery, attachments, plus webhooks and API keys for integration.
- Audit logging, analytics that survive email deletion, and a compliance posture built on accountability.

### Highlights in this release
- Inbox search and a status filter (active / expired / all) on the dashboard.
- System-admin platform audit view (`GET /admin/audit`) for org-less events: registration, login, password reset, account deletion, session revocation.
- Reliability: domain DNS rechecks no longer downgrade a verified domain on a transient lookup error; platform-level audit events now persist (they were previously dropped by a NOT NULL `org_id` constraint).
- UI: design-system-aligned SSO provider cards (semantic status badge, copyable redirect URL), consistent empty states across surfaces, and tabular figures on the analytics page.
- Testing: property-based tests for auth lock/migration, domain status/validation, and audit classification; DB-integration tests for analytics persistence, invite flows, and platform audit; a reusable react-query frontend test harness.

### Notes
- Database migrations through `000044` — run `migrate up` on deploy.
- API surface documented in `internal/handler/docs/openapi.json` (now v1.0.0).

## v0.48.3 (May 2026)
- Fix: session revocation race condition — RevokeOldestExceeding uses FOR UPDATE SKIP LOCKED
- Validation: platform settings upper bounds for all numeric fields
- Validation: inbox TTL range validation (0-365 days) for default_inbox_ttl and max_inbox_ttl
- Validation: password_min_length capped at 128, lockout_max_attempts at 100, lockout_duration at 24h
- Validation: max_attachment_size_mb (0-100), max_domains/max_teams (0-10000), max_inboxes_per_domain (0-100000)

## v0.48.2 (May 2026)
- Security: SSO state parameter increased from 128 to 256 bits (OWASP recommendation)
- Security: WebSocket origin validation removes unsafe fallback comparison path
- Validation: setup wizard validates admin email format and DisplayName
- Validation: setup wizard validates invite email format (skips invalid with warning)

## v0.48.1 (May 2026)
- Security: rate limiting added to verify-email endpoint (was unprotected)
- Security: SSOCallback origin validation now accepts all valid CORS origins
- Fix: writeServiceError handles auth lock, unlink, and SSO-only error messages correctly
- Fix: UpdateProfile handler surfaces validation errors instead of generic 500
- Validation: admin UpdateUser now validates DisplayName via auth.ValidateDisplayName
- Audit: added severity/category entries for admin.auth_migrated, admin.auth_method_lock_changed, user.login_session_conflict

## v0.48.0 (May 2026)
- Security: fix timing attack in Login — dummy bcrypt comparison on user-not-found path
- Security: fix DeleteAccount bypass for SSO-only users (now requires re-auth)
- Security: SetAuthMethodLock validates user has required credentials before locking
- Security: Refresh token rotation now carries forward SSOProviderName
- Security: UnlinkSSOIdentity checks AuthMethodLock before allowing unlink
- Fix: createAndProvisionFromMappings wrapped in transaction for atomicity
- Fix: SSOLogin email domain validation uses net/mail.ParseAddress consistently
- Config: configurable bcrypt cost via password_policy.bcrypt_cost
- Config: configurable email verification TTL via email_verification.ttl
- Validation: DisplayName required and capped at 200 characters
- Audit: MigrateToSSO and MigrateToPassword now log auth method changes
- Tracking: LastLoginAt updated on successful Login and SSOLogin
- Refactor: extracted shared enforceSessionLimit, extractEmailDomain, isDomainAllowed helpers

## v0.47.0 (May 2026)
- SSO session conflict dialog: SSO login now shows the same interactive session picker as password login when limit is reached
- SSO callback redirects to login page with pending token instead of silently auto-revoking
- New GET /auth/login/pending-sessions endpoint for fetching session list from pending token
- PendingLoginStore.Peek() for non-consuming token reads (SSO redirect flow)
- ua-parser-js integration: accurate browser, OS, and device type detection in session displays
- Device-type icons (desktop/mobile/tablet) in SessionConflictDialog and Sessions page
- Falls back to auto-revoke if Redis unavailable during SSO conflict detection

## v0.46.0 (April 2026)
- Session conflict resolution: interactive dialog when login hits session limit
- Two-phase login flow: 409 Conflict with pending token + active sessions list
- User picks which session to revoke via dialog, or cancels to keep all sessions
- POST /auth/login/resolve endpoint to complete login after user's choice
- PendingLoginStore: Redis-backed, single-use tokens with 5-min TTL
- SSO login retains auto-revoke behavior unchanged
- Race condition handling with fresh pending tokens on concurrent logins
- Frontend SessionConflictDialog with device info, IP, last active time
- Docs: removed outdated BUILDPLAN.md, TODO.md, web/README.md
- Docs: synced MDX docs with session limits config and conflict resolution API
- Fix: revocation cache now marked on all session revocation paths (user, admin, bulk)
- Fix: Redis fallback in Login() — auto-revokes oldest session when Redis is unavailable
- Fix: OpenAPI spec updated with /auth/login/resolve endpoint and 409 schemas

## v0.45.0 (April 2026)
- Session limits: configurable max active sessions per user (platform default + per-user override)
- Migration 000042: nullable max_sessions column on users table
- Admin platform settings: max_sessions_per_user (1-100, default 5)
- Admin user management: per-user session limit override
- Best-effort enforcement: oldest sessions auto-revoked on login when limit exceeded
- Immediate session invalidation: Redis-based revocation cache rejects old access tokens instantly
- Frontend: Session Limits section in Platform Settings, Session Limit field in User Detail Dialog
- Fix: LoadFromDB now restores all platform settings (max_sessions_per_user, inbox TTLs, quotas) from DB on restart

## v0.24.x (April 2026)
- Domains page: 6 UI enhancements (bulk actions, sort/filter, DNS copy, health indicator)
- Infrastructure: graceful shutdown, SMTP DATA timeout, chart gap filling
- RBAC page guards on admin-only pages
- Role-appropriate dashboard for members vs admins
- Persistent notifications with DB storage (migration 027-028)
- Real-time email notifications via Redis pub/sub bridge
- Single-org enforcement (4-layer protection)
- Premium auth pages (two-column layout, password strength, confirm password)
- Timezone/date-format user preferences (migration 026)

## v0.21.x-v0.22.x (April 2026)
- Neutral slate theme with orange accents
- Design system alignment (typography, shadows, transitions)
- All audit records enriched with metadata (35 actions)
- API key scope enforcement
- Analytics: top sender domains, UUID validation, error propagation

## v0.18.x-v0.20.x (April 2026)
- Full CRUD for Roles & Permissions
- Comprehensive audit logging (12 new actions)
- Auth page header/footer
- Setup TOCTOU race condition fix
- Unified UI elements across all pages
- Domain detail two-column layout
- All-time inbox counter per domain (migration 025)

## v0.9.8-v0.17.x (April 2026)
- Routing & auth fixes (redirect loops, invite acceptance)
- Security hardening (15 fixes: SSO, SSRF, bcrypt, rate limiting)
- Admin users management
- Dynamic RBAC with permissions tables (migration 024)
- AES-256-GCM encryption for sensitive config
- Enhanced notification center and command palette
- MDX documentation sync

## v0.1.0-v0.9.7 (Feb-Mar 2026)
- Initial platform: Go backend (chi, pgx, Redis)
- Next.js 16 frontend with shadcn/ui
- SMTP inbound server
- Domain management with DNS verification
- Team-based organization with RBAC
- Webhook system with retry
- API key authentication
- Real-time WebSocket inbox updates
