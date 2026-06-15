# BurnerByte

[![Pipeline](https://gitlab.com/burnerbyte/burnerbyte/badges/main/pipeline.svg)](https://gitlab.com/burnerbyte/burnerbyte/-/pipelines)
[![Release](https://gitlab.com/burnerbyte/burnerbyte/-/badges/release.svg)](https://gitlab.com/burnerbyte/burnerbyte/-/releases)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![Docker](https://img.shields.io/badge/self--hosted-docker-2496ED?logo=docker&logoColor=white)](docker-compose.yml)

Self-hosted, open-source temporary email platform with multi-team, multi-domain architecture.

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
- Audit logging with filtering, plus a system-admin platform audit view
- Analytics dashboard with time-series charts
- SSO via OIDC
- Private inboxes — only the creator can access
- Inbox search and status filtering (active / expired / all)
- Built-in documentation site at `/docs`
- Command palette with keyboard shortcuts and recent actions
- Persistent notifications with real-time delivery via Redis pub/sub
- Timezone and date-format user preferences
- Single-org enforcement (4-layer protection)
- Light-only interface by design (a dark theme is intentionally not shipped)
- OKLCH semantic color tokens with WCAG AA accessibility
- Reduced-motion support and screen reader accessibility
- Pull-to-refresh on mobile

## Quick Start

### Prerequisites

- Go 1.25+
- Node.js 20+ with pnpm
- Docker & Docker Compose
- PostgreSQL 16 (or use Docker)
- Redis 7 (or use Docker)

### Setup

```bash
# Clone
git clone git@gitlab.com:burnerbyte/burnerbyte.git
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
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`, `PATCH /auth/me`, `PUT /auth/me/password`, `DELETE /auth/me`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `GET /auth/verify-email/:token` |
| Sessions | `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `DELETE /auth/sessions` |
| SSO | `GET /auth/sso/:provider`, `GET /auth/sso/:provider/callback` |
| Orgs | `POST /orgs`, `GET /orgs`, `GET /orgs/:id`, `PATCH /orgs/:id`, `DELETE /orgs/:id`, `GET /orgs/:id/settings`, `PATCH /orgs/:id/settings`, `PUT /orgs/:id/settings` |
| Members | `POST /orgs/:id/members`, `GET /orgs/:id/members`, `PATCH /orgs/:id/members/:uid`, `DELETE /orgs/:id/members/:uid` |
| Invites | `POST /orgs/:id/invites`, `POST /invites/:token/accept` |
| Domains | `POST /orgs/:id/domains`, `GET /orgs/:id/domains`, `GET /orgs/:id/domains/:did`, `PATCH /orgs/:id/domains/:did`, `DELETE /orgs/:id/domains/:did`, `POST /orgs/:id/domains/:did/verify` |
| Teams | `POST /orgs/:id/teams`, `GET /orgs/:id/teams`, `GET /orgs/:id/teams/:tid`, `PATCH /orgs/:id/teams/:tid`, `DELETE /orgs/:id/teams/:tid` |
| Team Members | `POST /orgs/:id/teams/:tid/members`, `GET /orgs/:id/teams/:tid/members`, `PATCH .../members/:uid`, `DELETE .../members/:uid` |
| Domain Assignments | `POST /orgs/:id/teams/:tid/domains`, `GET /orgs/:id/teams/:tid/domains`, `PATCH .../domains/:did`, `DELETE .../domains/:did` |
| Inboxes | `POST /inboxes`, `GET /inboxes`, `GET /inboxes/:id`, `POST /inboxes/:id/extend`, `DELETE /inboxes/:id`, `GET /orgs/:id/teams/:tid/inboxes` |
| Emails | `GET /inboxes/:id/emails`, `GET /emails/:id`, `PATCH /emails/:id`, `DELETE /emails/:id`, `GET /emails/:id/attachments/:aid` |
| Webhooks | `POST /orgs/:id/teams/:tid/webhooks`, `GET .../webhooks`, `PATCH .../webhooks/:wid`, `DELETE .../webhooks/:wid`, `GET .../webhooks/:wid/deliveries` |
| API Keys | `POST /orgs/:id/teams/:tid/api-keys`, `GET .../api-keys`, `DELETE .../api-keys/:kid` |
| Audit | `GET /orgs/:id/audit`, `GET /orgs/:id/audit/export`, `GET /admin/audit` (system admin) |
| Analytics | `GET /orgs/:id/analytics`, `GET /orgs/:id/analytics/emails-per-day`, `GET /orgs/:id/teams/:tid/analytics`, `GET .../emails-per-day` |
| Admin | `GET /admin/stats`, `GET /admin/orgs`, `GET /admin/health` |
| WebSocket | `GET /ws/inboxes/:id`, `GET /ws/notifications` |
| Docs | `GET /docs`, `GET /docs/openapi.json` |
| Health | `GET /healthz`, `GET /readyz`, `GET /metrics` |

### Frontend Pages

| Route | Description |
|---|---|
| `/setup` | One-time setup wizard |
| `/login` | Sign in |
| `/register` | Create account |
| `/forgot-password` | Password reset request |
| `/reset-password` | Set new password via token |
| `/verify-email` | Email verification |
| `/invite` | Accept org invitation |
| `/onboarding` | Post-registration guided setup |
| `/dashboard` | Org overview with analytics |
| `/inboxes` | List & create inboxes |
| `/inboxes/[id]` | Email reader with WebSocket |
| `/email/[emailId]` | Email detail view |
| `/domains` | Domain management |
| `/domains/[domainId]` | Domain detail & DNS verification |
| `/teams` | Team management + domain assignments |
| `/webhooks` | Webhook configuration |
| `/api-keys` | API key management |
| `/audit` | Audit log viewer |
| `/analytics` | Analytics dashboard |
| `/settings` | Org settings + members |
| `/profile` | User profile & password change |
| `/profile/sessions` | Session management |
| `/profile/delete` | Account deletion |
| `/admin` | System admin stats |
| `/docs` | Documentation site (Fumadocs) |

## Tech Stack

- **Backend**: Go 1.25, Chi, pgxpool, go-redis, MinIO
- **Frontend**: Next.js 16, shadcn/ui, Tailwind CSS 4, Zustand, TanStack Query, Recharts
- **Design System**: OKLCH color tokens, semantic theming (light/dark), PRODUCT.md + DESIGN.md (Stitch format)
- **Docs**: Fumadocs (MDX, full-text search)
- **Infrastructure**: PostgreSQL 16 (28 migrations, 28 tables), Redis 7, MinIO, Docker
- **CI/CD**: GitLab CI (lint, build, test, Docker registry)

## Database

28 migrations, 52+ indexes, 7 triggers. 28 tables: users, organizations, org_memberships, teams, team_memberships, domains, domain_assignments, inboxes, emails, attachments, webhooks, webhook_delivery_logs, api_keys, audit_logs, invites, sessions, setup_state, password_reset_tokens, system_configs, roles, permissions, role_permissions, user_preferences, notifications, notification_subscriptions, email_domain_stats, org_settings, user_settings.

## Documentation

Full documentation is available at `/docs` when running the frontend. Built with [Fumadocs](https://fumadocs.vercel.app/), it covers:

- **Getting Started** — Installation, quick start, Docker, configuration reference
- **Architecture** — Two-binary design, SMTP pipeline, WebSocket, database schema, workers
- **Concepts** — RBAC, domains, inboxes, emails, webhooks, API keys, SSO, settings cascade
- **Self-Hosting** — Production hardening, reverse proxy (Nginx/Caddy), DNS setup, monitoring
- **API Reference** — Authentication, pagination, errors, all 50+ endpoints
- **Frontend** — Tech stack, keyboard shortcuts, UX patterns, theming, design system

### Design System Files

| File | Purpose |
|---|---|
| `PRODUCT.md` | Strategic context: users, brand personality, anti-references, design principles |
| `DESIGN.md` | Visual spec: OKLCH palette, typography, elevation, components, do's/don'ts |
| `.impeccable/design.json` | Machine-readable sidecar: tonal ramps, motion tokens, component snippets |

## License

Apache 2.0 — see [LICENSE](LICENSE)
