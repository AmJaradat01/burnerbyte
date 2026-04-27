# Changelog

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
