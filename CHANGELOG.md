# Changelog

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
