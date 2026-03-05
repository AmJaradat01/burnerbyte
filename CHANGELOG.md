# Changelog

## v0.7.9 (2026-03-05)

### Features
- **i18n support** — Added `next-intl` with English and Arabic translations; locale switcher in sidebar and landing page; RTL support for Arabic; cookie-based locale persistence
- **Live inbox updates** — Home page connects to notification WebSocket and auto-refreshes inbox cards when new emails arrive
- **TTL cascade exposed to frontend** — `GET /my/domains` returns resolved `default_ttl` and `max_ttl` per domain assignment; create dialog dynamically filters TTL presets and shows max limit
- **Smart renew** — Extend/renew endpoint accepts empty duration and defaults to the domain's resolved default TTL; error message now shows the max TTL
- **New endpoint `GET /my/domains`** — Returns all domain assignments the user can create inboxes on (across all their teams), with resolved TTL settings

### UI/UX Enhancements
- **Home page (`/`)** — Auth-aware: landing page for guests, inbox workspace for logged-in users with create inbox, status tabs, card grid, pagination, live refresh
- **Sidebar restructured** — Removed org/team selectors (single-org, auto-selected); nav split into User (Home, Inboxes, Docs), Manage (Dashboard, Domains, Teams, etc.), and System (Admin) sections; logo links to `/`
- **All list pages rewritten as card grids** — Inboxes, Domains, Teams, Webhooks, API Keys with counts, badges, and actions
- **Profile page** — 2-column layout, avatar, SSO detection, password section hidden for SSO users, confirm password with mismatch indicator
- **Audit page** — Timeline cards, date range filters, expandable detail panel, color-coded action badges
- **Analytics page** — Stat cards with icons, top sender domains with progress bars, improved chart
- **Settings page** — 2-column layout, branding fields (primary color swatch, footer text), danger zone
- **Admin page** — Three tabs: Overview (stat cards with icons), Organizations (paginated table), Health (auto-refreshing Postgres/Redis status)
- **Docs landing** — 3 categorized card sections, Self-Hosting link in nav
- **Renew button** — Replaced "Extend" with "Renew" across all pages; uses backend-resolved default TTL instead of hardcoded 1h
- **Create inbox dialog** — Uses `GET /my/domains` (no team selection needed); shows `alias@domain` preview; TTL presets filtered by max TTL; empty state when no domains available

### Backend Enhancements
- Added `TotalInboxes` to `OrgStats` and `TeamStats`; `TotalTeams`, `TotalDomains`, `ActiveInboxes` to `SystemStats`
- Added `top_sender_domains` query to org analytics
- Added `EmailCount`, `UnreadCount` to `Inbox` struct with correlated subqueries
- Added `ActiveInboxes`, `TeamCount` to `Domain` struct
- Added `MemberCount`, `DomainCount`, `ActiveInboxes` to `Team` struct
- Added `ActorEmail` to `AuditEntry` via LEFT JOIN
- Added inbox status filter (`?status=active|expired|all`) with `ListByUserWithStatus` and `ListByTeamWithStatus`
- Added `ListByUser` to `DomainAssignmentRepo` — returns assignments across all user's teams
- Added `DefaultTTL`, `MaxTTL` resolved fields to `DomainAssignment` struct
- `ExtendTTL` now accepts empty duration (uses resolved default TTL)

### Bug Fixes
- Fixed analytics/admin page crash on undefined stat values (`?? 0` guard)
- Fixed authenticated users seeing landing page instead of home on `/`
- Fixed `currentTeam` always null after removing sidebar selectors (auto-select first team)
- Added CORS origin for LAN IP

### Types Updated
- `User`: added `sso_provider`, `updated_at`
- `Inbox`: added `email_count`, `unread_count`
- `Domain`: added `dns_last_checked_at`, `active_inboxes`, `team_count`
- `Team`: added `member_count`, `domain_count`, `active_inboxes`
- `Webhook`: added `failure_count`, `last_status`, `last_attempt_at`
- `APIKey`: added `expires_at`
- `OrgSettings`: added `primary_color`, `footer_text`
- `DomainAssignment`: added `access_level`, `default_ttl`, `max_ttl`

## v0.7.8 (2026-03-02)

### Documentation
- Synced all `/docs` pages with actual API implementation
- Fixed team role names in RBAC docs (`team_admin` → `lead`, `team_member` → `member`, `team_viewer` → `viewer`)
- Fixed audit log permission matrix (requires `admin`, not `member`)
- Fixed API key hashing docs (`bcrypt` → `SHA-256`)
- Fixed webhook signature header (`X-Signature-256` → `X-BurnerByte-Signature`)
- Fixed webhook retry count (4 → 3 attempts)
- Fixed SSO provider config example (short name → OIDC issuer URL)
- Fixed settings cascade: `max_attachment_size_mb` is org-only, added branding fields
- Fixed Docker service count (5 → 6)
- Fixed Go version in installation docs (1.22+ → 1.25+)
- Fixed Next.js version in README badge and tech stack (15 → 16)
- Fixed page count in architecture overview (24 → 26)
- Fixed attachment cascade description (org → domain → team → org → domain assignment)
- Added missing `GET /orgs/:id/teams/:tid/inboxes` to API reference
- Added missing Docs endpoint group to API reference
- Clarified health endpoints are root-level (not under `/api/v1`)
- Added missing CORS fields and email verification config to configuration docs
- Documented new `webhook_max_retries` and `analytics_default_days` config options

### Backend
- Made webhook max retries configurable (`defaults.webhook_max_retries`, default: 3)
- Made analytics default days configurable (`defaults.analytics_default_days`, default: 30)
- Fixed SSO cookie `Secure` flag — derived from `FrontendURL` scheme instead of hardcoded `true`
- Deduplicated WebSocket constants in `notif_ws.go` (reuses shared constants from `ws.go`)

### Frontend
- Deduplicated `WS_BASE` — single export from `lib/api.ts`
- Deduplicated `PaginatedResponse` — removed 5 local redefinitions, import from `@/types`

### OpenAPI
- Expanded spec from ~30 to 52 paths covering all registered endpoints
- Added 9 new schemas (Webhook, APIKey, DomainAssignment, Membership, Session, AuditEntry, Invite, PaginatedResponse)
- Added reusable parameter components
- Bumped spec version to 0.7.8

### Version Bumps
- Frontend: 0.1.0 → 0.7.8
- OpenAPI spec: 0.6.12 → 0.7.8

## v0.7.7 (2026-03-01)

### CI/CD
- Added automatic GitLab Release creation on tag push via `release-cli`
- Backfilled CHANGELOG entries for v0.7.1 through v0.7.6

## v0.7.6 (2026-03-01)

### Documentation
- Updated README with badges (pipeline, release, license, Go, Next.js, Docker)
- Fixed Go version from 1.22+ to 1.25+
- Added `/docs` to frontend pages table
- Added Docs and CI/CD to tech stack section
- Added docs site and command palette to features list

## v0.7.5 (2026-03-01)

### CI/CD
- Fixed `test:migrations` job — override entrypoint for `migrate/migrate` image (scratch-based, no shell), use absolute path `/migrate`, bump to v4.17.1
- Fixed `test:go` job — set `CGO_ENABLED=1` and install `gcc musl-dev` for race detector on Alpine, `when: always` on artifacts for empty test suite

## v0.7.4 (2026-03-01)

### CI/CD
- Fixed `build:frontend` job — removed redundant `cd web` in script (already in `web/` from `before_script`)

## v0.7.3 (2026-03-01)

### CI/CD
- Fixed Docker image tags — `golang:1.25-alpine` shorthand doesn't exist (Go 1.26 is current), changed to `golang:1.25-alpine3.23` in CI and Dockerfile

## v0.7.2 (2026-03-01)

### CI/CD
- Added `.golangci.yml` with errcheck exclusions for idiomatic Go patterns (defer Close/Rollback, HTTP writes, viper BindEnv, crypto/rand.Read, S3 cleanup, webhook logging)
- Fixed 51 errcheck issues across 14 Go files
- Fixed staticcheck QF1008 — removed redundant `.Time` from embedded `jwt.NumericDate` field

## v0.7.1 (2026-03-01)

### CI/CD
- Updated `golangci-lint` from v1.62 to v2.10 (Go 1.25+ support)
- Updated Go CI images from 1.22 to 1.25 (match `go.mod`)
- Updated Dockerfile Go builder from 1.22 to 1.25

### Bug Fixes
- Fixed 21 ESLint errors and 12 warnings across 17 frontend files
- Added `.source/` to ESLint ignores (fumadocs generated files)
- Added docs route to command palette
- Added missing `delete` label to breadcrumbs

## v0.7.0 (2026-03-01)

### Features
- **Full documentation site with Fumadocs** — 26 MDX pages covering getting started, architecture, concepts, self-hosting, API reference, and frontend. Accessible at `/docs` with full-text search, dark/light theme, and sidebar navigation.

### Documentation Pages
- **Getting Started** — Installation, Quick Start, Docker Setup, Configuration Reference (all env vars and config.yaml options)
- **Architecture** — System Overview, SMTP Pipeline, Real-time WebSocket, Database Schema, Background Workers
- **Concepts** — RBAC (6 roles + permission matrix), Domains, Inboxes, Emails, Webhooks, API Keys, SSO, Settings Cascade
- **Self-Hosting** — Production Deployment, Reverse Proxy (Nginx/Caddy), DNS Setup, Monitoring
- **API Reference** — Authentication, pagination, errors, all 50+ endpoints listed
- **Frontend** — Tech stack, keyboard shortcuts, UX patterns, theming

### Changes
- Added `fumadocs-core`, `fumadocs-ui`, `fumadocs-mdx`, `shiki`, `@types/mdx` dependencies
- Next.js config migrated from `next.config.ts` to `next.config.mjs` (required by fumadocs-mdx)
- Added Fumadocs CSS imports to `globals.css`
- Added `/docs` to public paths in app shell (accessible without auth)
- Added Docs link to sidebar navigation
- Updated README documentation section

## v0.6.12 (2026-03-01)

### UI/UX
- **Sessions "Revoke All" had no confirmation** — The destructive "Revoke All" button on the sessions page immediately revoked all sessions without asking. Now uses `ConfirmDialog` consistent with the rest of the app.
- **Team delete used browser `confirm()`** — The "Delete Team" button used the native browser `confirm()` dialog instead of the app's `ConfirmDialog` component. Replaced for visual consistency and a more descriptive warning message.

### Configurability
- **Docker Compose MinIO credentials hardcoded in api/smtpd services** — `BB_MINIO_ACCESS_KEY`, `BB_MINIO_SECRET_KEY`, and `BB_MINIO_BUCKET` in the `api` and `smtpd` services now reference `${MINIO_ROOT_USER}`, `${MINIO_ROOT_PASSWORD}`, and `${MINIO_BUCKET}` env vars instead of hardcoded `minioadmin`/`burnerbyte`.
- **Docker Compose ports hardcoded** — MinIO (9000/9001), API (8080), SMTPD (2525), and frontend (3000) ports are now configurable via `MINIO_PORT`, `MINIO_CONSOLE_PORT`, `API_PORT`, `SMTPD_PORT`, and `FRONTEND_PORT` env vars.
- **`.env.example` updated** — Added Docker Compose override section documenting all configurable port and credential env vars.

### Maintenance
- **OpenAPI spec version** updated from `0.6.8` to `0.6.12`.

## v0.6.11 (2026-03-01)

### Documentation
- **README API endpoints table incomplete** — Was missing 18 routes: `PATCH /auth/me`, `DELETE /auth/me`, `POST /auth/reset-password`, `GET /auth/verify-email/:token`, sessions endpoints, SSO endpoints, `GET /orgs/:id/domains/:did`, `PATCH /orgs/:id/domains/:did`, `PATCH /orgs/:id/settings`, `GET /orgs/:id/teams/:tid`, `PATCH .../domains/:did`, `GET /emails/:id/attachments/:aid`, `GET .../webhooks/:wid/deliveries`, `GET /orgs/:id/teams/:tid/inboxes`, admin/orgs, admin/health, WebSocket, and Docs routes.
- **README frontend pages table incomplete** — Was missing 8 pages: `/reset-password`, `/onboarding`, `/dashboard`, `/email/[emailId]`, `/domains/[domainId]`, `/profile`, `/profile/sessions`, `/profile/delete`.
- **README migration count stale** — Updated from 19 to 21, added `password_reset_tokens` and `system_configs` tables.

## v0.6.10 (2026-03-01)

### Cleanup
- **Removed dead `internal/rbac/` package** — 3 files (enforcer.go, permissions.go, roles.go) that were never imported. The active RBAC implementation lives in `internal/auth/rbac/`.

## v0.6.9 (2026-03-01)

### Bug Fixes
- **Setup handler invite fallback used hardcoded 48h** — When `InviteExpiryTTL` config was zero, the setup handler fell back to a hardcoded `48 * time.Hour` instead of using the configured value.

### Enhancements
- **Docker Compose: Redis port and MinIO credentials now configurable** — Redis port uses `${REDIS_PORT:-6379}`, MinIO credentials use `${MINIO_ROOT_USER}` / `${MINIO_ROOT_PASSWORD}` env var overrides.
- **Complete `.env.example`** — Added all missing config sections: rate limiting, lockout, password policy, defaults (TTLs), workers, CORS, metrics, email verification, server timeouts, max body size.
- **Frontend `.env.example`** — Added `web/.env.example` documenting `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL`.
- **OpenAPI spec version updated** — Was stuck at `0.2.0`, now matches release `0.6.8`.

## v0.6.8 (2026-03-01)

### Bug Fixes
- **Setup invite emails had broken Accept button** — Template uses `{{.AcceptURL}}` but setup handler passed `InviteURL`. The invite email's "Accept Invite" button linked to an empty URL. Also missing `InviterName`, rendering as "has invited you..." with no name.
- **Email templates showed hardcoded expiry times** — Invite template said "48 hours" and password reset said "1 hour" regardless of configured TTLs. Both now use dynamic `{{.ExpiresIn}}` with human-readable formatting (e.g., "2 days", "1 hour", "15 minutes").

## v0.6.7 (2026-03-01)

### Security
- **No request body size limit on API endpoints** — All API endpoints accepted arbitrarily large request bodies, allowing a malicious client to exhaust server memory with a single request. Added configurable `server.max_body_size` (default: 1 MB) enforced via `http.MaxBytesReader` middleware.

## v0.6.6 (2026-02-28)

### Security
- **Setup wizard invites never worked** — The setup handler sent invite emails with `?org=...&email=...` URL format but the invite page expects `?token=...`. Additionally, no invite records were created in the database, so even with the correct URL the accept endpoint would fail. Fixed by creating proper invite records in the DB during the setup transaction and using token-based URLs.

### Enhancements
- **Configurable TTLs** — Five previously hardcoded durations are now configurable via `config.yaml` or environment variables:
  - `defaults.password_reset_ttl` (default: 1h) — password reset token lifetime
  - `defaults.invite_expiry_ttl` (default: 48h) — org invite link lifetime
  - `defaults.presigned_url_ttl` (default: 15m) — attachment download URL lifetime
  - `defaults.webhook_timeout` (default: 10s) — webhook HTTP delivery timeout
  - `defaults.analytics_cache_ttl` (default: 2h) — analytics stats Redis cache lifetime

## v0.6.5 (2026-02-28)

### Security
- **XSS via HTML email iframe on email detail page** — `email/[emailId]/page.tsx` used `sandbox="allow-same-origin"` on the HTML email iframe, allowing malicious email HTML to access the parent page's cookies and session storage. The inbox detail page was already fixed in v0.5.9 but the standalone email detail page was missed. Changed to `sandbox=""`.

### Bug Fixes
- **Onboarding domain assignment missing access_level** — The onboarding wizard sent `{ domain_id }` without the required `access_level` field when assigning a domain to the initial team. The backend rejected the request with "invalid access_level: ". Fixed by including `access_level: "full"`.

## v0.6.4 (2026-02-28)

### Bug Fixes
- **Password reset token cleanup broken** — `PasswordResetRepo.DeleteExpired` referenced table `password_resets` but the actual table is `password_reset_tokens`. The cleanup worker silently failed to delete expired tokens, causing them to accumulate indefinitely in the database.

## v0.6.3 (2026-02-28)

### Bug Fixes
- **Setup transaction not atomic** — SMTP and storage configs were saved outside the setup transaction (SystemConfigRepo used pgxpool.Pool directly, not the transaction). If the transaction failed after saving configs, the DB had orphaned config entries and the in-memory mailer was already reconfigured. Fixed by adding `WithTx` to SystemConfigRepo and deferring in-memory updates until after commit.
- **Nil pointer panic in settings resolver** — `ResolveAttachmentsEnabled` accessed `dom.OrgID` without checking if the domain lookup failed. If the domain was deleted between inbox creation and settings resolution, the SMTP handler would panic. Now returns the system default when domain lookup fails.

## v0.6.2 (2026-02-28)

### Bug Fixes
- **Invite dialog sent wrong field name** — Settings page invite dialog sent `{role}` but the backend expects `{org_role}`. All invites from the settings page failed with "invalid org_role". Fixed to send `org_role`.
- **Non-existent roles in frontend dropdowns** — Settings page role change and invite dialogs offered "viewer" and "billing" roles that don't exist in the backend RBAC system (only owner/admin/member). Selecting them caused a 400 error. Setup wizard also offered "viewer". Removed all non-existent role options.

## v0.6.1 (2026-02-28)

### Security
- **Inbox creation authorization bypass** — `CreateInboxByAssignment` did not verify the calling user is a member of the team that owns the domain assignment. Any authenticated user who knew an assignment ID could create inboxes on any team's domain. Now verifies team membership before proceeding.

### Bug Fixes
- **Invite acceptance transaction not committed** — When a user who is already an org member accepts an invite (idempotent path), `MarkInviteAccepted` ran on the transaction but the function returned without committing. The deferred `Rollback` undid the update, so the invite was never marked as accepted.

## v0.6.0 (2026-02-28)

### Webhook Secret Visibility
- Webhook HMAC signing secret was never returned to the user — the field had `json:"-"` so it was stripped from all API responses including creation. Users could never configure signature verification on their endpoints. Changed to `json:"secret,omitempty"` and clear the field in List/Update responses so it's only visible on creation.
- Frontend webhook creation dialog now shows the signing secret once after creation (same UX pattern as API key creation).

### Auth Middleware Hardening
- `writeJSON` in auth middleware used string concatenation instead of `json.Marshal` — a latent JSON injection risk if error messages ever contained special characters. Fixed to use `encoding/json`.

## v0.5.9 (2026-02-28)

### Security
- HTML email iframe used `sandbox="allow-same-origin"` — malicious HTML emails could access the parent page's localStorage and steal JWT tokens via JavaScript. Changed to `sandbox=""` (fully sandboxed opaque origin).

### SMTP
- Router accepted RCPT TO for expired/inactive inboxes in the PG fallback path. The sending MTA got `250 OK` but the email was silently dropped during processing. Now rejects at RCPT TO time with `550 inbox expired`.

## v0.5.8 (2026-02-28)

### Security — Cross-Tenant Resource Access
- Domain Get/Update/Delete/Verify did not verify the domain belonged to the org in the URL — an admin of Org A could operate on Org B's domains by guessing the UUID. Service methods now verify `orgID` ownership.
- Team Get/Update/Delete had the same cross-org issue. Fixed with `orgID` verification.
- Webhook Update/Delete and API Key Revoke did not verify the resource belonged to the team in the URL — a team lead of Team A could manipulate Team B's webhooks/keys. Service methods now verify `teamID` ownership.
- Webhook ListDeliveryLogs had the same cross-team issue. Fixed.
- Added `APIKeyRepo.GetByID` for ownership check in Revoke.

### Bug Fixes
- Frontend domain unassign completely broken — passed assignment ID (`a.id`) but backend expects domain ID. Changed to `a.domain_id`.
- Frontend API key creation offered scopes `inbox:write` and `webhook:manage` which the backend rejects. Fixed to match backend: `inbox:create`, `inbox:read`, `email:read`, `email:delete`.

## v0.5.7 (2026-02-28)

### Build & Email Fixes
- Frontend Docker build broken — Next.js config missing `output: "standalone"` so `.next/standalone` never existed
- Invite emails showed blank org name and inviter name in the template
- Removed dead-code membership check that used uuid.Nil (always passed)

## v0.5.6 (2026-02-28)

### Security & Configuration Fixes
- Admin routes missing RequireSystemAdmin — any user could view system stats and all orgs
- .env.example had wrong env var names (missing BB_ prefix) — SMTP, Mailer, MinIO, SSO, JWT TTL vars were silently ignored by Viper

## v0.5.5 (2026-02-28)

### Security & UX Fixes
- Password reset now revokes all sessions (refresh tokens could bypass password change)
- Session revocation scoped by user ID (was an IDOR — any user could revoke any session)
- Notification center shows readable messages instead of raw JSON
- Domain list now shows TXT verification record when domain is pending verification

## v0.5.4 (2026-02-28)

### Critical WebSocket & Data Fixes
- WebSocket inbox connection was completely broken (wrong URL path + auth couldn't work via headers)
- Auth middleware now accepts ?token= query param for WebSocket upgrades
- Inbox webhook dispatch now uses actual team ID (was uuid.Nil — events were silently dropped)
- Paginated API responses now return [] instead of null for empty lists

## v0.5.3 (2026-02-28)

### Frontend/Backend Field Mismatch Fixes
- API keys page: key prefix showed as 'undefined' (frontend used 'prefix', backend sends 'key_prefix')
- Webhook TypeScript type: corrected 'is_active' to 'active' matching backend JSON
- Domain detail page: TXT verification record was never shown (backend didn't include verification_record in response)

## v0.5.2 (2026-02-28)

### Broken Email Link Fixes
- Password reset email now links to /reset-password (was /forgot-password — wrong page)
- Email verification link now uses ?token= query param (was path param — caused 404)
- Invite acceptance link now uses ?token= query param (was path param — caused 404)
- Register endpoint now rate-limited (was unprotected)

## v0.5.1 (2026-02-28)

### Token Refresh Race Condition Fix
- API client now deduplicates concurrent token refresh attempts
- Prevents session family revocation when multiple 401s fire simultaneously

## v0.5.0 (2026-02-28)

### Setup Wizard: Storage & Persistent Runtime Configs
- New `system_configs` table stores runtime configuration as JSONB key-value pairs
- Setup wizard now includes Object Storage step: choose MinIO or AWS S3 with endpoint, credentials, bucket, region, and SSL
- SMTP mailer config from setup wizard is now persisted to DB (survives restarts)
- Both API and SMTPD binaries load mailer + storage configs from DB on startup, overriding config.yaml/env defaults
- Migration 021: `system_configs` table

## v0.4.5 (2026-02-28)

### WebSocket & Docker Fixes
- Fix Hub.Broadcast type mismatch — now satisfies RealtimeHub interface
- SMTP handler wraps email in Message envelope before WebSocket broadcast
- Docker Compose: add MinIO env vars and dependency to api and smtpd services

## v0.4.4 (2026-02-28)

### Pagination Error Handling
- Check errors on COUNT queries in webhook, apikey, and audit repos
- Prevents silent zero-total responses when database connection fails

## v0.4.3 (2026-02-28)

### Notification Hub Wiring
- SMTP handler now pushes `email.received` notifications to the user-level NotifHub
- Notification center WebSocket clients receive live push notifications when emails arrive
- Previously the NotifHub existed but was never called — now fully wired end-to-end

## v0.4.2 (2026-02-28)

### Cleanup & SSO
- Cleanup worker: now purges expired sessions and password reset tokens (previously only emails/inboxes)
- Password reset repo: `DeleteExpired` method for token cleanup
- Login page: handles SSO callback — picks up `access_token` and `refresh_token` from URL query params after OIDC redirect

## v0.4.1 (2026-02-28)

### Backend Correctness Fixes
- SMTP: raw email headers now stored in DB and returned via API (Raw Headers tab works)
- Email detail API: attachments list populated from DB (was always empty)
- Attachment download: returns JSON `{url}` instead of HTTP redirect (frontend compatible)
- Webhook Create/Update: JSON decode errors now return 400 instead of silently ignoring
- API Key Create: JSON decode error now returns 400
- Email domain struct: added `attachments` field for inline attachment data

## v0.4.0 (2026-02-28)

### UI/UX Enhancements
- Landing page: gradient hero, animated open-source badge, feature cards with hover effects, bottom CTA, sticky header
- Login/Register: centered branding logo, gradient background
- Sidebar: active nav indicator bar (left accent), user avatar initial circle, admin shield icon
- Dashboard: time-of-day greeting (Good morning/afternoon/evening), org subtitle
- Profile: avatar preview circle with initial fallback, streamlined layout
- Relative timestamps: `timeAgo` utility applied to inbox email list and audit log (with full date tooltip on hover)
- Empty states: replaced all inline empty states with reusable `EmptyState` component across inboxes, domains, teams, webhooks, API keys

## v0.3.9 (2026-02-28)

### Onboarding Wizard
- 5-step post-login onboarding for users with no orgs: create org → add domain (with DNS verification instructions + copy button) → create team (auto-assigns domain) → create first inbox → done
- Skippable at any step with progress indicator
- Completion state stored in localStorage
- Auto-redirect from sidebar when user has zero orgs

## v0.3.8 (2026-02-28)

### Final Polish
- Inbox detail: auto-marks email as read when previewed (PATCH call on select)
- WebSocket: reconnect with exponential backoff (1s → 2s → 5s → 10s)
- Settings: Danger Zone — delete organization with typed name confirmation
- Admin page: error state + loading skeleton (from v0.3.7)
- Sessions page: error state + error toasts (from v0.3.7)

## v0.3.7 (2026-02-28)

### Final BUILDPLAN Completion
- Analytics: date range selector (last 7d, 30d, 90d) with `?days=` backend param
- Audit log: Export to CSV button (client-side export of current page)
- Webhooks: expandable delivery log rows per webhook (timestamp, status code, response time, success/failure badge)
- Webhooks: GET `.../webhooks/{id}/deliveries` backend endpoint
- Domain detail: DNS auto-poll every 30s while domain is not fully verified
- Admin page: error state + loading skeleton
- Sessions page: error state + error toasts

## v0.3.6 (2026-02-28)

### Remaining BUILDPLAN Features
- Keyboard shortcuts: `?` shows help overlay, extensible per-page (n/j/k/d/Esc)
- Notification center: WebSocket push notifications dropdown with unread badge, mark all read, dismiss
- Global error boundary + route-level error boundary with retry
- Email detail page: spam score badge (low/medium/high), HTML/Plain Text/Raw Headers tabs, attachment download cards
- Reset password page (/reset-password?token=...)
- Wired notification center + shortcut help in app shell

## v0.3.5 (2026-02-28)

### BE/FE Sync & UI/UX
- Inbox detail: copy address button, live countdown timer, attachment download chips, email delete with confirm
- Inbox detail: pagination on email list, error states, responsive stacked/split layout, unread dot indicator
- Sidebar: icons on all navigation items
- Dashboard: error state with retry
- Analytics: error state with retry, loading skeletons

## v0.3.4 (2026-02-28)

### Frontend Cross-Cutting Concerns
- Pagination component with prev/next on all list pages (inboxes, domains, webhooks, API keys, audit, members)
- ErrorState component with retry button on all data-fetching pages
- ConfirmDialog on all destructive actions (delete inbox, remove domain, delete webhook, revoke key, remove member)
- Optimistic updates with rollback on delete mutations via TanStack Query cache
- Search/filter: domain list (by name), member list (by name/email), audit log (by action/resource)
- Toast notifications on all mutations (already present, now consistent)
- Skeleton loaders on all list pages (already present, now consistent)

## v0.3.3 (2026-02-28)

### Error Handling & Cleanup
- Structured error responses: all errors return `{ error, code }` with status-mapped codes (validation_error, forbidden, conflict, etc.)
- Email deletion cleans up associated S3 attachments
- Cleanup worker deletes S3 objects when expiring emails
- MinIO client + AttachmentService wired in API server
- Inbox creation returns 409 on duplicate alias conflict
- EmailRepo.DeleteExpiredReturningIDs for attachment-aware cleanup

## v0.3.2 (2026-02-28)

### Service Enhancements
- Settings cascade: ResolveDefaultInboxTTL, ResolveMaxInboxTTL, ResolveMaxAttachmentSize walk assignment → org → system defaults
- Inbox service uses settings cascade for TTL resolution instead of hardcoded system defaults
- SMTP handler stores attachments via settings cascade (checks attachments_enabled + max size)
- SMTP handler calculates basic spam score (missing headers, SPF result, suspicious patterns)
- SMTP handler broadcasts new emails to WebSocket hub for real-time delivery
- SMTPD binary wired with MinIO, attachment service, and settings resolver

## v0.3.1 (2026-02-28)

### Cross-Cutting Enhancements
- Audit recording on all 22 BUILDPLAN events (org, team, domain, webhook, apikey, inbox CRUD)
- Webhook dispatch: `email.received` from SMTP handler, `inbox.created` from inbox handler
- API key dual auth middleware (`bb_` prefix → SHA-256 hash lookup, JWT fallback)
- `enforce_sso` check on password login (blocks if org enforces SSO)
- `ValidateAndResolve` on API key service for programmatic auth

## v0.3.0 (2026-02-28)

### Auth & Security
- **RBAC enforcement** — Org-role and team-role checks on every handler per BUILDPLAN permission matrix; system admins bypass all checks
- **Rate limiting** — Fixed-window per-IP rate limiter with `X-RateLimit-Limit/Remaining/Reset` headers; separate limiters for authenticated (100/min), unauthenticated (20/min), login (5/min), forgot-password (3/hour); IPv6 support; graceful shutdown
- **SSO/OIDC** — Full `coreos/go-oidc/v3` integration with lazy provider discovery, state cookie CSRF protection, auto-verify SSO users, account linking by email

### API
- **Attachment download** — `GET /emails/:emailId/attachments/:attachmentId` with presigned S3 URL redirect
- **Admin routes** — `GET /admin/orgs` (list all orgs), `GET /admin/health` (DB + Redis ping)
- **Swagger/OpenAPI** — OpenAPI 3.0.3 spec at `/api/v1/docs/openapi.json`, Swagger UI at `/api/v1/docs`

### WebSocket
- **Inbox WebSocket** — `WS /ws/inboxes/:inboxId` with ping/pong keepalive, inbox ownership verification, CORS origin validation, proper goroutine coordination
- **Notifications WebSocket** — `WS /ws/notifications` user-level push channel with dedicated NotifHub

### SMTP
- **TCP listener** — Full RFC 5321 SMTP protocol with ESMTP extensions (SIZE, 8BITMIME, PIPELINING, ENHANCEDSTATUSCODES), dot-stuffing, enmime MIME parsing, per-command timeouts, graceful shutdown
- **SMTPD binary** — Fully wired `cmd/smtpd/main.go` with DB pool, Redis, repos, Router, Handler, Server, Listener

### Workers
- **Cleanup worker** — Wired via worker.Manager with configurable interval
- **Reconciler worker** — Redis ↔ PostgreSQL inbox sync using `InboxRepo.ListActive()`

### Frontend — New Pages
- `/dashboard` — Org overview with stats cards and emails-per-day chart
- `/profile` — Edit display name, avatar, change password
- `/profile/sessions` — List and revoke active sessions
- `/profile/delete` — Account deletion with password confirmation
- `/domains/:domainId` — DNS verification status, assigned teams, re-verify
- `/email/:emailId` — Full email view with attachment download links
- `/` — Landing page with features grid

### Frontend — UX Enhancements
- Dark/light mode with system preference default (next-themes)
- Command palette (Cmd+K) for quick page navigation
- Breadcrumbs on nested pages
- Skeleton loaders on data-fetching pages
- Empty states with icons and CTAs on all list pages
- Responsive mobile layout with Sheet sidebar
- Team settings tab (rename/delete) and team analytics tab

### Infrastructure
- `Dockerfile.smtpd` — Standalone SMTPD Docker image
- `docker-compose.yml` — Full stack: API, SMTPD, frontend, PostgreSQL, Redis, MinIO
- `.gitlab-ci.yml` — Lint → build → test → deploy pipeline with Docker image promotion on tags

## v0.2.0 (2026-02-28)

### Bug Fixes
- **Router**: Replaced nested `r.Route()` sub-routers with flat route registration to fix 404s on all endpoints with 2+ path parameters (e.g. `/orgs/{orgId}/teams/{teamId}/...`). Chi's trie-based router creates isolated sub-routers that conflict when routes at different nesting depths share path param prefixes.
- All 30 API endpoints now return correct responses (previously 17 returned 404)

### Changes
- `cmd/api/main.go` — flat route registration, auth middleware via `r.Group`
- All handler files — removed `authMw` parameter, simplified `Routes()` methods
- Auth handler split into `PublicRoutes()` and `AuthenticatedRoutes()`

## v0.1.0 (2026-02-28)

Initial release of BurnerByte — self-hosted temporary email platform.

### Setup Wizard
- One-time setup wizard with 8 steps (admin, org, SMTP, domain, team, branding, invites, review)
- Locked after completion — cannot re-run unless database is reset
- Transactional: all-or-nothing setup with automatic rollback on failure
- Auto-login after setup completion

### Backend (Go)

- **Auth**: Registration, login, JWT access/refresh tokens, password reset, email verification, account lockout, SSO/OIDC structure
- **Organizations**: CRUD, settings (JSONB with branding fields), slug generation, invite system with email
- **Teams**: CRUD, membership management, slug generation, quota enforcement
- **Domains**: CRUD, MX/TXT DNS verification, quota enforcement
- **Domain Assignments**: Assign domains to teams with access levels, settings cascade (assignment → domain → org → system)
- **RBAC**: 6 roles (owner, admin, member, viewer, billing at org; lead, member, viewer at team), full permission matrix, org-level fallback
- **Inboxes**: Create with random/alias address, TTL management, Redis cache for SMTP lookups, private to creator, user-scoped listing
- **SMTP Server**: Inbound email processing, buffered queue with worker pool, 451 backpressure, Redis→PG fallback routing
- **Email Storage**: Full-text search (tsvector), pagination, mark read/unread
- **Attachments**: S3/MinIO storage, presigned download URLs, size validation, cascade delete
- **Webhooks**: HMAC-SHA256 signed delivery, 3 retries with exponential backoff, delivery logs
- **API Keys**: `bb_` prefixed, SHA-256 hashed, scoped access
- **Audit Log**: Filterable by action/resource/actor, paginated
- **Analytics**: Org/team/system stats, emails-per-day time series (30-day window)
- **WebSocket**: Real-time email delivery per inbox
- **Workers**: Expired inbox/email cleanup, Redis↔PG reconciliation

### Frontend (Next.js)

- **Shell**: App Router, shadcn/ui, Tailwind CSS, Zustand stores, React Query, API client with JWT auto-refresh
- **Setup Wizard**: 8-step wizard with progress bar, required/optional badges, review summary
- **Auth Pages**: Login, register, forgot password, email verification, invite acceptance
- **Org Dashboard**: Settings (general + policies + branding), members with role management, invite dialog
- **Domain Management**: List, add, verify (MX/TXT), remove
- **Team Management**: List, create, members, domain assignments
- **Inbox View**: List with create/extend/delete, inbox detail with email list + reader, WebSocket real-time, search
- **Webhooks**: CRUD with event selection, toggle active
- **API Keys**: Create (shows raw key once), list, revoke, scope selection
- **Audit Log**: Filterable table with pagination
- **Analytics**: Stats cards, emails-per-day bar chart (Recharts), org + team views
- **Admin**: System-wide stats (system admin only)

### API Route Alignment
- All routes use consistent `/orgs/{orgId}/...` prefix for org-scoped resources
- User-scoped inbox endpoints: `GET /inboxes`, `POST /inboxes`, `POST /inboxes/{id}/extend`
- Analytics time-series: `GET /orgs/{id}/analytics/emails-per-day`, `GET /orgs/{id}/teams/{tid}/analytics/emails-per-day`
- Audit: `GET /orgs/{id}/audit`

### Infrastructure

- PostgreSQL 16, Redis 7, MinIO (Docker Compose)
- 19 migrations (52 indexes, 7 triggers, setup_state singleton)
- Multi-stage Dockerfiles for API, SMTP, and frontend
- Makefile with all common tasks
