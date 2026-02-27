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

- Multi-org, multi-team, multi-domain hierarchy
- Full RBAC with 6 roles across org and team levels
- Real-time email delivery via WebSocket
- Configurable attachment policies with inheritance cascade
- Webhooks with retry and delivery logs
- Scoped API keys
- Audit logging
- Analytics dashboard
- SSO via OIDC
- Private inboxes — only the creator can access

## Quick Start

### Prerequisites

- Go 1.22+
- Node.js 20+ with pnpm
- Docker & Docker Compose

### Setup

```bash
# Clone
git clone git@gitlab.com:amjaradat01/burnerbyte.git
cd burnerbyte

# Start infrastructure
make docker-up

# Copy env
cp .env.example .env

# Run migrations
make migrate-up

# Start API server
make run-api

# Start SMTP server (separate terminal)
make run-smtp

# Start frontend (separate terminal)
cd web && pnpm install && pnpm dev
```

### Endpoints

| Endpoint | Description |
|---|---|
| `http://localhost:8080/healthz` | Liveness probe |
| `http://localhost:8080/readyz` | Readiness probe |
| `http://localhost:8080/metrics` | Prometheus metrics |
| `http://localhost:3000` | Frontend UI |

## Tech Stack

- **Backend**: Go, Chi, pgxpool, go-redis, go-guerrilla, MinIO
- **Frontend**: Next.js 14+, shadcn/ui, Tailwind CSS, Zustand, TanStack Query
- **Infrastructure**: PostgreSQL 16, Redis 7, MinIO, Docker

## License

Apache 2.0 — see [LICENSE](LICENSE)
