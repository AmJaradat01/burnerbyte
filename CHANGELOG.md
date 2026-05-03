# Changelog

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
