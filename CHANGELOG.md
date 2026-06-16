# Changelog

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
