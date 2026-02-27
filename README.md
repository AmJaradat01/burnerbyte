# BurnerByte

Self-hosted, open-source temporary email platform with multi-org, multi-team, multi-domain architecture.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌───────────┐
│  Next.js UI │────▶│   Go API     │────▶│ PostgreSQL│
│  (port 3000)│     │  (port 8080) │     └───────────┘
└─────────────┘     │              │────▶┌───────────┐
                    │  Chi Router  │     │   Redis   │
┌─────────────┐     │  + Workers   │     └───────────┘
│ Mail Server │────▶│              │────▶┌───────────┐
│  (external) │     └──────────────┘     │   MinIO   │
└─────────────┘                          └───────────┘
       │
       ▼
┌──────────────┐
│  Go SMTPD    │
│  (port 2525) │
└──────────────┘
```

Two separate binaries scale independently:
- `cmd/api` — HTTP API server + background workers
- `cmd/smtpd` — SMTP inbound server

## Features

- One-time setup wizard (admin, org, SMTP, domain, team, branding, invites)
- Single-org architecture with multi-team, multi-domain hierarchy
- Full RBAC with 6 roles across org and team levels
- Real-time email delivery via WebSocket
- Configurable attachment policies with inheritance cascade
- Webhooks with HMAC-SHA256 signing, retry, and delivery logs
- Scoped API keys
- Audit logging with filtering
- Analytics dashboard with time-series charts
- SSO via OIDC
- Private inboxes — only the creator can access

## Quick Start

### Prerequisites

- Go 1.22+
- Node.js 20+ with pnpm
- Docker & Docker Compose
- PostgreSQL 16 (or use Docker)
- Redis 7 (or use Docker)

### Setup

```bash
# Clone
git clone git@gitlab.com:amjaradat01/burnerbyte.git
cd burnerbyte

# Start infrastructure (Redis + MinIO; skip if using local PG)
make docker-up

# Copy env
cp .env.example .env

# Run migrations
make migrate-up

# Start API server
make run-api

# Start frontend (separate terminal)
cd web && pnpm install && pnpm dev
```

On first launch, navigate to `http://localhost:3000` — the setup wizard will guide you through:
1. Creating the platform owner account
2. Setting up your organization
3. Configuring outbound SMTP
4. Adding your first domain
5. (Optional) Creating a team, branding, inviting users

### API Endpoints

| Group | Endpoints |
|---|---|
| Setup | `GET /setup/status`, `POST /setup/complete` |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`, `PUT /auth/me/password`, `POST /auth/forgot-password` |
| Orgs | `POST /orgs`, `GET /orgs`, `GET /orgs/:id`, `PATCH /orgs/:id`, `GET /orgs/:id/settings`, `PUT /orgs/:id/settings` |
| Members | `POST /orgs/:id/members`, `GET /orgs/:id/members`, `PATCH /orgs/:id/members/:uid`, `DELETE /orgs/:id/members/:uid` |
| Invites | `POST /orgs/:id/invites`, `POST /invites/:token/accept` |
| Domains | `POST /orgs/:id/domains`, `GET /orgs/:id/domains`, `DELETE /orgs/:id/domains/:did`, `POST /orgs/:id/domains/:did/verify` |
| Teams | `POST /orgs/:id/teams`, `GET /orgs/:id/teams`, `PATCH /orgs/:id/teams/:tid`, `DELETE /orgs/:id/teams/:tid` |
| Team Members | `POST /orgs/:id/teams/:tid/members`, `GET /orgs/:id/teams/:tid/members`, `PATCH .../members/:uid`, `DELETE .../members/:uid` |
| Domain Assignments | `POST /orgs/:id/teams/:tid/domains`, `GET /orgs/:id/teams/:tid/domains`, `DELETE .../domains/:did` |
| Inboxes | `POST /inboxes`, `GET /inboxes`, `GET /inboxes/:id`, `POST /inboxes/:id/extend`, `DELETE /inboxes/:id` |
| Emails | `GET /inboxes/:id/emails`, `GET /emails/:id`, `PATCH /emails/:id`, `DELETE /emails/:id` |
| Webhooks | `POST /orgs/:id/teams/:tid/webhooks`, `GET .../webhooks`, `PATCH .../webhooks/:wid`, `DELETE .../webhooks/:wid` |
| API Keys | `POST /orgs/:id/teams/:tid/api-keys`, `GET .../api-keys`, `DELETE .../api-keys/:kid` |
| Audit | `GET /orgs/:id/audit` |
| Analytics | `GET /orgs/:id/analytics`, `GET /orgs/:id/analytics/emails-per-day`, `GET /orgs/:id/teams/:tid/analytics`, `GET .../emails-per-day` |
| Admin | `GET /admin/stats` |
| Health | `GET /healthz`, `GET /readyz`, `GET /metrics` |

### Frontend Pages

| Route | Description |
|---|---|
| `/setup` | One-time setup wizard |
| `/login` | Sign in |
| `/register` | Create account |
| `/forgot-password` | Password reset |
| `/verify-email` | Email verification |
| `/invite` | Accept org invitation |
| `/inboxes` | List & create inboxes |
| `/inboxes/[id]` | Email reader with WebSocket |
| `/domains` | Domain management |
| `/teams` | Team management + domain assignments |
| `/webhooks` | Webhook configuration |
| `/api-keys` | API key management |
| `/audit` | Audit log viewer |
| `/analytics` | Analytics dashboard |
| `/settings` | Org settings + members |
| `/admin` | System admin stats |

## Tech Stack

- **Backend**: Go, Chi, pgxpool, go-redis, MinIO
- **Frontend**: Next.js 15+, shadcn/ui, Tailwind CSS, Zustand, TanStack Query, Recharts
- **Infrastructure**: PostgreSQL 16, Redis 7, MinIO, Docker

## Database

19 migrations, 52+ indexes, 7 triggers. Tables: users, organizations, org_memberships, teams, team_memberships, domains, domain_assignments, inboxes, emails, attachments, webhooks, webhook_delivery_logs, api_keys, audit_logs, invites, sessions, setup_state.

## License

Apache 2.0 — see [LICENSE](LICENSE)
