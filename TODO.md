# BurnerByte — Enhancement TODO

Tracked gaps between current implementation and BUILDPLAN.md.
Mark `[x]` when complete. Work top-down by priority.

---

## Backend

### Auth & Security
- [x] **RBAC enforcement** — Add org-role and team-role checks to every handler (currently any authenticated user can access any org/team endpoint; only `RequireSystemAdmin` exists)
- [x] **Rate limiting middleware** — Config struct exists but no middleware implementation; add per-IP rate limiter on auth endpoints and global limiter
- [ ] **SSO/OIDC** — `GET /auth/sso/:provider`, `GET /auth/sso/:provider/callback`; integrate `coreos/go-oidc/v3`; auto-verify SSO users; enforce_sso org setting
- [x] **Password change JWT invalidation** — Middleware rejects tokens issued before `password_changed_at` (already implemented)

### API Routes
- [x] **Attachment download** — `GET /emails/:emailId/attachments/:attachmentId`; repo and S3 client exist, need handler + presigned URL generation + route
- [x] **Admin: list orgs** — `GET /admin/orgs`
- [x] **Admin: system health** — `GET /admin/health` (check DB, Redis, SMTP connectivity)
- [ ] **Swagger/OpenAPI** — Add `swaggo/swag` annotations, wire `GET /api/v1/docs` and `GET /api/v1/docs/openapi.json`

### WebSocket
- [x] **Inbox WebSocket endpoint** — `WS /api/v1/ws/inboxes/:inboxId`; Hub exists in `internal/realtime/hub.go` but no HTTP upgrade handler or route is wired
- [ ] **Notifications WebSocket** — `WS /api/v1/ws/notifications`; user-level push notifications channel

### SMTP Server
- [ ] **Wire SMTPD binary** — `cmd/smtpd/main.go` is a stub; connect it to `internal/smtp/Server.Start()` with DB pool, Redis, config
- [ ] **TCP listener** — Add actual TCP accept loop (go-guerrilla or stdlib `net.Listen`); currently `internal/smtp/server.go` has worker pool but no listener
- [ ] **Add go-guerrilla dependency** — Not in `go.mod`; or implement lightweight SMTP listener with stdlib

### Background Workers
- [x] **Start cleanup worker** — `internal/worker/cleanup.go` exists but is never started in `cmd/api/main.go`; add ticker goroutine
- [ ] **Reconciler worker** — Redis ↔ PostgreSQL inbox reconciliation; config fields exist (`ReconcilerInterval`) but no implementation

---

## Frontend

### Missing Pages
- [ ] **Profile page** (`/profile`) — User settings: display name, avatar, change password
- [ ] **Profile sessions** (`/profile/sessions`) — List active sessions, revoke individual/all
- [ ] **Profile delete** (`/profile/delete`) — Account deletion with password confirmation
- [ ] **Dashboard** (`/dashboard`) — Org overview with stats, recent activity, org switcher
- [ ] **Domain detail** (`/domains/:domainId`) — DNS verification status, assigned teams, per-domain settings
- [ ] **Email detail** (`/email/:emailId`) — Full email view with attachment download links
- [ ] **Landing page** (`/`) — Marketing/features page (currently minimal or redirect)

### Missing Page Sections
- [ ] **Team settings tab** — Per-team settings page within `/teams`
- [ ] **Team analytics tab** — Per-team analytics within `/teams` (API exists, no dedicated UI section)

### UX Enhancements
- [ ] **Dark/light mode** — Theme toggle with system preference default; persist choice
- [ ] **Command palette** — Cmd+K quick navigation across pages
- [ ] **Breadcrumbs** — Org → Team → Domain → Inbox contextual navigation
- [ ] **Skeleton loaders** — Loading states on all data-fetching pages
- [ ] **Empty states** — Illustrations with clear CTAs when lists are empty
- [ ] **Responsive/mobile** — Mobile-friendly layout for quick inbox checks

---

## Infrastructure
- [ ] **SMTPD Dockerfile** — Exists but binary is a stub; update after SMTPD is wired
- [ ] **Docker Compose** — Add SMTPD service entry once binary works
- [ ] **CI/CD pipeline** — `.gitlab-ci.yml` for lint, build, test, deploy stages

---

## Done (v0.2.0)
- [x] All 30 API endpoints returning correct responses
- [x] Flat route registration (Chi router fix)
- [x] Password reset with token storage (migration 020)
- [x] Setup wizard (8-step, transactional)
- [x] Hydration fix, null coalescing, stripPort
- [x] Metrics endpoint (`/metrics` via promhttp)
- [x] Settings cascade resolver
- [x] Account lockout (Redis-backed)
- [x] 20 database migrations
