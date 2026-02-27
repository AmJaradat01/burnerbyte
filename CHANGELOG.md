# Changelog

## v0.1.0 (2026-02-28)

Initial release of BurnerByte — self-hosted temporary email platform.

### Backend (Go)

- **Auth**: Registration, login, JWT access/refresh tokens, password reset, email verification, account lockout, SSO/OIDC structure
- **Organizations**: CRUD, settings (JSONB), slug generation, invite system with email
- **Teams**: CRUD, membership management, slug generation, quota enforcement
- **Domains**: CRUD, MX/TXT DNS verification, quota enforcement
- **Domain Assignments**: Assign domains to teams with access levels, settings cascade (assignment → domain → org → system)
- **RBAC**: 6 roles (owner, admin, member, viewer, billing at org; lead, member, viewer at team), full permission matrix, org-level fallback
- **Inboxes**: Create with random/alias address, TTL management, Redis cache for SMTP lookups, private to creator
- **SMTP Server**: Inbound email processing, buffered queue with worker pool, 451 backpressure, Redis→PG fallback routing
- **Email Storage**: Full-text search (tsvector), pagination, mark read/unread
- **Attachments**: S3/MinIO storage, presigned download URLs, size validation, cascade delete
- **Webhooks**: HMAC-SHA256 signed delivery, 3 retries with exponential backoff, delivery logs
- **API Keys**: `bb_` prefixed, SHA-256 hashed, scoped access
- **Audit Log**: Filterable by action/resource/actor, paginated
- **Analytics**: Org/team/system stats, emails-per-day time series
- **WebSocket**: Real-time email delivery per inbox
- **Workers**: Expired inbox/email cleanup, Redis↔PG reconciliation

### Frontend (Next.js)

- **Shell**: App Router, shadcn/ui, Tailwind CSS, Zustand stores, React Query, API client with JWT auto-refresh
- **Auth Pages**: Login, register, forgot password, email verification
- **Org Dashboard**: Settings (general + policies), members with role management, invite dialog
- **Domain Management**: List, add, verify (MX/TXT), remove
- **Team Management**: List, create, members, domain assignments
- **Inbox View**: List with create/extend/delete, inbox detail with email list + reader, WebSocket real-time, search
- **Webhooks**: CRUD with event selection, toggle active
- **API Keys**: Create (shows raw key once), list, revoke, scope selection
- **Audit Log**: Filterable table with pagination
- **Analytics**: Stats cards, emails-per-day bar chart (Recharts), org + team views
- **Admin**: System-wide stats (system admin only)

### Infrastructure

- PostgreSQL 16, Redis 7, MinIO (Docker Compose)
- 18 migrations (52 indexes, 7 triggers)
- Multi-stage Dockerfiles for API, SMTP, and frontend
- Makefile with all common tasks
