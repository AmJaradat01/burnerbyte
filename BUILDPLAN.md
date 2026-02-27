# BurnerByte — Master Build Plan

> **This document is the single source of truth for building BurnerByte.**
> Every feature branch, every file, every endpoint is defined here.
> Follow this plan sequentially. Do not skip steps. Do not leave stubs or TODOs in code.
> Every item must be a fully functioning, complete implementation.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Architecture & Hierarchy](#architecture--hierarchy)
4. [Git Flow Strategy](#git-flow-strategy)
5. [Data Model](#data-model)
6. [RBAC & Permissions](#rbac--permissions)
7. [Settings Cascade](#settings-cascade)
8. [API Routes](#api-routes)
9. [Frontend Page Map](#frontend-page-map)
10. [Build Phases & Feature Branches](#build-phases--feature-branches)
11. [Release Checklist](#release-checklist)

---

## Project Overview

BurnerByte is a self-hosted, open-source temporary email platform built for organizations.
It supports multi-org, multi-team, multi-domain architecture with full RBAC,
real-time email delivery via WebSocket, configurable attachment policies,
webhooks, API keys, audit logging, and analytics.

- **License:** Apache 2.0
- **Repository:** `gitlab.com/amjaradat01/burnerbyte`

---

## Tech Stack

### Backend

| Layer | Technology |
|---|---|
| Language | Go 1.22+ |
| HTTP Router | `chi` (lightweight, stdlib-compatible) |
| SMTP Server | `go-guerrilla` |
| Database | PostgreSQL 16+ via `pgxpool` |
| Cache/TTL | Redis 7+ via `go-redis/v9` |
| Object Storage | MinIO (S3-compatible) for attachments |
| Auth - passwords | `bcrypt` |
| Auth - tokens | JWT (access 15min + refresh 7d) via `golang-jwt/jwt/v5` |
| Auth - SSO | OIDC via `coreos/go-oidc/v3` |
| Migrations | `golang-migrate/migrate/v4` |
| Config | `spf13/viper` |
| Email parsing | `jhillyerd/enmime` |
| WebSocket | `gorilla/websocket` |
| Logging | `log/slog` (stdlib, JSON output) |
| Metrics | `prometheus/client_golang` |
| Rate limiting | `rate` (stdlib) + per-IP tracking |
| API Docs | `swaggo/swag` (OpenAPI 3.0 auto-generation) |
| Outbound Email | `net/smtp` (stdlib) or `jordan-wright/email` — for sending invites, password resets |

### Frontend

| Layer | Technology |
|---|---|
| Framework | Next.js 14+ (App Router, TypeScript) |
| Package Manager | pnpm |
| UI Library | shadcn/ui (Radix + Tailwind) |
| Styling | Tailwind CSS |
| State | Zustand |
| Data Fetching | TanStack Query (React Query) |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
| Toasts | Sonner |
| Real-time | Native WebSocket client |

### Infrastructure

| Component | Technology |
|---|---|
| Containers | Docker + docker-compose |
| Database | PostgreSQL 16 |
| Cache | Redis 7 |
| Object Storage | MinIO |
| Monitoring | Prometheus + Grafana (optional) |

---

## Architecture & Hierarchy

```
Organization (top-level tenant)
  ├── Domain (owned at org level, managed by org admins)
  │    └── DNS verification, attachment policy, settings
  │
  ├── Team (grouping of members within org)
  │    └── Domain Assignment (team gets scoped access to specific domains)
  │         ├── access_level: full | create_inbox | read_only
  │         ├── Settings override (attachment policy, max TTL)
  │         └── Inbox (belongs to team, under an assigned domain)
  │              └── Email → Attachments
  │
  └── Members (org-level membership, then assigned to teams)
```

### Key Design Decisions

- **Two separate binaries**: `cmd/api` (HTTP) and `cmd/smtpd` (SMTP) — scale independently
- **Domains are org-level resources** — centralized management, assigned to teams
- **Domain assignments carry permissions** — same domain shared across teams with different access levels
- **Redis for email bodies with TTL** — auto-expiry without cron jobs
- **PostgreSQL for durable data** — orgs, teams, users, domains, metadata
- **MinIO for attachments** — S3-compatible, self-hosted
- **Settings cascade** — system → org → domain → team assignment (first explicit value wins)

---

## Git Flow Strategy

```
main              ← stable releases only (tagged: v0.1.0, v0.2.0, etc.)
  └── develop     ← integration branch, all features merge here
       ├── feature/001-project-skeleton
       ├── feature/002-database-schema
       ├── feature/003-auth-system
       ├── feature/004-org-management
       ├── feature/005-domain-management
       ├── feature/006-team-management
       ├── feature/007-rbac-engine
       ├── feature/008-domain-assignment
       ├── feature/009-inbox-system
       ├── feature/010-smtp-server
       ├── feature/011-email-storage
       ├── feature/012-attachments
       ├── feature/013-webhooks
       ├── feature/014-api-keys
       ├── feature/015-audit-log
       ├── feature/016-analytics
       ├── feature/017-websocket-realtime
       ├── feature/018-background-workers
       ├── feature/019-frontend-shell
       ├── feature/020-frontend-auth-pages
       ├── feature/021-frontend-org-dashboard
       ├── feature/022-frontend-domain-management
       ├── feature/023-frontend-team-management
       ├── feature/024-frontend-inbox-view
       ├── feature/025-frontend-email-view
       ├── feature/026-frontend-settings-pages
       ├── feature/027-frontend-webhooks-apikeys
       ├── feature/028-frontend-audit-analytics
       └── release/v0.1.0 ← first stable release
```

### Branch Rules

- Each feature branch is created from `develop`
- Each feature branch is merged back to `develop` via merge commit (no squash)
- Release branches are created from `develop`, merged to both `main` and back to `develop`
- Tags are created on `main` only
- Never commit directly to `main` or `develop`

---

## Data Model

### Users

```sql
users
├── id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── email           VARCHAR(255) UNIQUE NOT NULL
├── display_name    VARCHAR(255) NOT NULL
├── avatar_url      TEXT
├── password_hash   TEXT                          -- NULL if SSO-only
├── sso_provider    VARCHAR(50)                   -- 'google', 'okta', etc.
├── sso_subject     VARCHAR(255)                  -- provider's user ID
├── is_system_admin BOOLEAN DEFAULT FALSE
├── email_verified  BOOLEAN DEFAULT FALSE         -- true after email verification or SSO login
├── password_changed_at TIMESTAMPTZ               -- used to invalidate sessions on password change
├── created_at      TIMESTAMPTZ DEFAULT NOW()
├── updated_at      TIMESTAMPTZ DEFAULT NOW()
├── UNIQUE(sso_provider, sso_subject)
```

### Organizations

```sql
organizations
├── id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── name            VARCHAR(255) NOT NULL
├── slug            VARCHAR(255) UNIQUE NOT NULL
├── logo_url        TEXT
├── settings        JSONB DEFAULT '{}'::jsonb
│    ├── attachments_enabled      BOOLEAN (default: true)
│    ├── default_inbox_ttl        DURATION (default: "10m")
│    ├── max_inbox_ttl            DURATION (default: "24h")
│    ├── max_attachment_size_mb   INT (default: 25)
│    ├── max_domains              INT (default: 10)
│    ├── max_teams                INT (default: 50)
│    ├── max_inboxes_per_domain   INT (default: 100)
│    └── enforce_sso              BOOLEAN (default: false)
├── created_at      TIMESTAMPTZ DEFAULT NOW()
├── updated_at      TIMESTAMPTZ DEFAULT NOW()
```

### Org Memberships

```sql
org_memberships
├── id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── user_id         UUID REFERENCES users(id) ON DELETE CASCADE
├── org_id          UUID REFERENCES organizations(id) ON DELETE CASCADE
├── role            VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'admin', 'member'))
├── created_at      TIMESTAMPTZ DEFAULT NOW()
├── UNIQUE(user_id, org_id)
```

### Teams

```sql
teams
├── id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── org_id          UUID REFERENCES organizations(id) ON DELETE CASCADE
├── name            VARCHAR(255) NOT NULL
├── slug            VARCHAR(255) NOT NULL
├── settings        JSONB DEFAULT '{}'::jsonb
│    ├── attachments_enabled   TEXT ('inherit' | 'enabled' | 'disabled', default: 'inherit')
│    └── max_inbox_ttl         DURATION (nullable, inherit from org)
├── created_at      TIMESTAMPTZ DEFAULT NOW()
├── updated_at      TIMESTAMPTZ DEFAULT NOW()
├── UNIQUE(org_id, slug)
```

### Team Memberships

```sql
team_memberships
├── id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── user_id         UUID REFERENCES users(id) ON DELETE CASCADE
├── team_id         UUID REFERENCES teams(id) ON DELETE CASCADE
├── role            VARCHAR(20) NOT NULL CHECK (role IN ('lead', 'member', 'viewer'))
├── created_at      TIMESTAMPTZ DEFAULT NOW()
├── UNIQUE(user_id, team_id)
```

### Domains

```sql
domains
├── id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── org_id          UUID REFERENCES organizations(id) ON DELETE CASCADE
├── domain_name     VARCHAR(255) UNIQUE NOT NULL
├── mx_verified     BOOLEAN DEFAULT FALSE
├── txt_verified    BOOLEAN DEFAULT FALSE
├── dns_last_checked_at TIMESTAMPTZ
├── settings        JSONB DEFAULT '{}'::jsonb
│    └── attachments_enabled   TEXT ('inherit' | 'enabled' | 'disabled', default: 'inherit')
├── created_at      TIMESTAMPTZ DEFAULT NOW()
├── updated_at      TIMESTAMPTZ DEFAULT NOW()
```

### Domain Assignments

```sql
domain_assignments
├── id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── team_id         UUID REFERENCES teams(id) ON DELETE CASCADE
├── domain_id       UUID REFERENCES domains(id) ON DELETE CASCADE
├── access_level    VARCHAR(20) NOT NULL CHECK (access_level IN ('full', 'create_inbox', 'read_only'))
├── settings        JSONB DEFAULT '{}'::jsonb
│    ├── attachments_enabled   TEXT ('inherit' | 'enabled' | 'disabled', default: 'inherit')
│    └── max_inbox_ttl         DURATION (nullable, inherit)
├── assigned_by     UUID REFERENCES users(id)
├── created_at      TIMESTAMPTZ DEFAULT NOW()
├── updated_at      TIMESTAMPTZ DEFAULT NOW()
├── UNIQUE(team_id, domain_id)
```

### Inboxes

```sql
inboxes
├── id                    UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── domain_assignment_id  UUID REFERENCES domain_assignments(id) ON DELETE CASCADE
├── domain_id             UUID REFERENCES domains(id) ON DELETE CASCADE  -- denormalized for fast SMTP lookup
├── created_by            UUID REFERENCES users(id)
├── address               VARCHAR(64) NOT NULL          -- local part (e.g., "a8xk2m")
├── full_address          VARCHAR(320) UNIQUE NOT NULL   -- address@domain, globally unique
├── is_active             BOOLEAN DEFAULT TRUE           -- false when expired (before cleanup)
├── expires_at            TIMESTAMPTZ NOT NULL
├── created_at            TIMESTAMPTZ DEFAULT NOW()
```

**Inbox access rules:**
- Inboxes are strictly private. Only the creator can see the inbox and its emails.
- No sharing, no team visibility. Each user's inboxes are completely isolated.
- Team leads, org admins, and org owners CANNOT see other users' inboxes or emails (privacy).
- Team leads/org admins can only see aggregate stats (inbox count, email count) for analytics — never the content.
- The SMTP server routes emails to the inbox regardless — access control only applies to the API/UI layer.

### Emails

```sql
emails
├── id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── inbox_id        UUID REFERENCES inboxes(id) ON DELETE CASCADE
├── message_id      VARCHAR(995)                 -- RFC 5322 Message-ID header, for deduplication
├── from_address    VARCHAR(320) NOT NULL
├── to_address      VARCHAR(320) NOT NULL
├── subject         TEXT
├── body_text       TEXT
├── body_html       TEXT
├── has_attachments BOOLEAN DEFAULT FALSE
├── raw_headers     JSONB
├── size_bytes      BIGINT NOT NULL DEFAULT 0    -- total email size
├── spam_score      REAL DEFAULT 0.0
├── is_read         BOOLEAN DEFAULT FALSE        -- read/unread status
├── received_at     TIMESTAMPTZ DEFAULT NOW()
├── expires_at      TIMESTAMPTZ NOT NULL
├── search_vector   TSVECTOR                     -- full-text search index
```

### Attachments

```sql
attachments
├── id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── email_id        UUID REFERENCES emails(id) ON DELETE CASCADE
├── filename        VARCHAR(255) NOT NULL
├── content_type    VARCHAR(255) NOT NULL
├── size_bytes      BIGINT NOT NULL
├── storage_key     TEXT NOT NULL                -- S3/MinIO object key
├── created_at      TIMESTAMPTZ DEFAULT NOW()
```

### Webhooks

```sql
webhooks
├── id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── team_id         UUID REFERENCES teams(id) ON DELETE CASCADE
├── created_by      UUID REFERENCES users(id)
├── url             TEXT NOT NULL
├── secret          VARCHAR(255) NOT NULL
├── events          JSONB NOT NULL               -- ["email.received", "inbox.created", "inbox.expired"]
├── active          BOOLEAN DEFAULT TRUE
├── last_status     INT                          -- last HTTP response code
├── last_attempt_at TIMESTAMPTZ
├── failure_count   INT DEFAULT 0
├── created_at      TIMESTAMPTZ DEFAULT NOW()
├── updated_at      TIMESTAMPTZ DEFAULT NOW()
```

### Webhook Delivery Logs

```sql
webhook_delivery_logs
├── id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── webhook_id      UUID REFERENCES webhooks(id) ON DELETE CASCADE
├── event           VARCHAR(50) NOT NULL         -- e.g., "email.received"
├── payload         JSONB NOT NULL
├── response_status INT                          -- HTTP status code
├── response_body   TEXT                         -- truncated response (first 1KB)
├── response_time_ms INT                         -- round-trip time
├── success         BOOLEAN NOT NULL
├── attempt         INT NOT NULL DEFAULT 1       -- retry attempt number
├── idempotency_key VARCHAR(255) NOT NULL        -- event_id + webhook_id
├── created_at      TIMESTAMPTZ DEFAULT NOW()
```

### API Keys

```sql
api_keys
├── id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── team_id         UUID REFERENCES teams(id) ON DELETE CASCADE
├── created_by      UUID REFERENCES users(id)
├── key_hash        TEXT NOT NULL                -- SHA-256 hash
├── key_prefix      VARCHAR(12) NOT NULL         -- first 8 chars for display (e.g., "bb_a8xk...")
├── name            VARCHAR(255) NOT NULL
├── scopes          JSONB NOT NULL               -- ["inbox:create", "email:read"]
├── last_used_at    TIMESTAMPTZ
├── expires_at      TIMESTAMPTZ
├── created_at      TIMESTAMPTZ DEFAULT NOW()
```

### Audit Logs

```sql
audit_logs
├── id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── org_id          UUID REFERENCES organizations(id) ON DELETE CASCADE
├── actor_id        UUID REFERENCES users(id)
├── action          VARCHAR(100) NOT NULL        -- e.g., "member.invited", "domain.created"
├── resource_type   VARCHAR(50) NOT NULL         -- e.g., "org", "team", "domain"
├── resource_id     UUID NOT NULL
├── metadata        JSONB DEFAULT '{}'::jsonb    -- additional context
├── ip_address      INET
├── created_at      TIMESTAMPTZ DEFAULT NOW()
```

### Invites

```sql
invites
├── id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── org_id          UUID REFERENCES organizations(id) ON DELETE CASCADE
├── team_id         UUID REFERENCES teams(id) ON DELETE CASCADE  -- nullable, if team-specific invite
├── email           VARCHAR(255) NOT NULL
├── org_role        VARCHAR(20) NOT NULL CHECK (org_role IN ('owner', 'admin', 'member'))
├── team_role       VARCHAR(20) CHECK (team_role IN ('lead', 'member', 'viewer'))  -- nullable
├── token           VARCHAR(255) UNIQUE NOT NULL
├── invited_by      UUID REFERENCES users(id)
├── accepted_at     TIMESTAMPTZ                  -- null until accepted
├── expires_at      TIMESTAMPTZ NOT NULL
├── created_at      TIMESTAMPTZ DEFAULT NOW()
```

### Sessions

```sql
sessions
├── id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── user_id         UUID REFERENCES users(id) ON DELETE CASCADE
├── refresh_token_hash TEXT NOT NULL              -- SHA-256 hash of refresh token
├── token_family    UUID NOT NULL                 -- for rotation: all tokens in a family share this ID
├── ip_address      INET
├── user_agent      TEXT
├── last_used_at    TIMESTAMPTZ DEFAULT NOW()
├── expires_at      TIMESTAMPTZ NOT NULL
├── revoked         BOOLEAN DEFAULT FALSE
├── created_at      TIMESTAMPTZ DEFAULT NOW()
```

### Indexes

```sql
-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_sso ON users(sso_provider, sso_subject) WHERE sso_provider IS NOT NULL;

-- Org memberships
CREATE INDEX idx_org_memberships_user ON org_memberships(user_id);
CREATE INDEX idx_org_memberships_org ON org_memberships(org_id);
CREATE INDEX idx_org_memberships_org_role ON org_memberships(org_id, role);

-- Teams
CREATE INDEX idx_teams_org ON teams(org_id);

-- Team memberships
CREATE INDEX idx_team_memberships_user ON team_memberships(user_id);
CREATE INDEX idx_team_memberships_team ON team_memberships(team_id);
CREATE INDEX idx_team_memberships_team_role ON team_memberships(team_id, role);

-- Domains
CREATE INDEX idx_domains_org ON domains(org_id);
CREATE INDEX idx_domains_name ON domains(domain_name);
CREATE INDEX idx_domains_mx_verified ON domains(org_id, mx_verified);

-- Domain assignments
CREATE INDEX idx_domain_assignments_team ON domain_assignments(team_id);
CREATE INDEX idx_domain_assignments_domain ON domain_assignments(domain_id);

-- Inboxes
CREATE INDEX idx_inboxes_assignment ON inboxes(domain_assignment_id);
CREATE INDEX idx_inboxes_domain ON inboxes(domain_id);                    -- fast SMTP routing
CREATE INDEX idx_inboxes_full_address ON inboxes(full_address);           -- SMTP lookup
CREATE INDEX idx_inboxes_created_by ON inboxes(created_by);              -- user's inbox list
CREATE INDEX idx_inboxes_expires ON inboxes(expires_at) WHERE is_active = TRUE;  -- cleanup worker
CREATE INDEX idx_inboxes_active ON inboxes(domain_id, is_active) WHERE is_active = TRUE;  -- active inbox count

-- Emails
CREATE INDEX idx_emails_inbox ON emails(inbox_id);
CREATE INDEX idx_emails_inbox_received ON emails(inbox_id, received_at DESC);  -- inbox list sorted by time
CREATE INDEX idx_emails_received ON emails(received_at);
CREATE INDEX idx_emails_expires ON emails(expires_at);
CREATE INDEX idx_emails_message_id ON emails(message_id) WHERE message_id IS NOT NULL;  -- dedup
CREATE INDEX idx_emails_search ON emails USING GIN(search_vector);
CREATE INDEX idx_emails_unread ON emails(inbox_id, is_read) WHERE is_read = FALSE;  -- unread count

-- Attachments
CREATE INDEX idx_attachments_email ON attachments(email_id);

-- Webhooks
CREATE INDEX idx_webhooks_team ON webhooks(team_id);
CREATE INDEX idx_webhooks_active ON webhooks(team_id, active) WHERE active = TRUE;

-- Webhook delivery logs
CREATE INDEX idx_webhook_delivery_logs_webhook ON webhook_delivery_logs(webhook_id);
CREATE INDEX idx_webhook_delivery_logs_created ON webhook_delivery_logs(created_at);
CREATE INDEX idx_webhook_delivery_logs_idempotency ON webhook_delivery_logs(idempotency_key);

-- API keys
CREATE INDEX idx_api_keys_team ON api_keys(team_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_expires ON api_keys(expires_at) WHERE expires_at IS NOT NULL;

-- Audit logs
CREATE INDEX idx_audit_logs_org ON audit_logs(org_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_org_created ON audit_logs(org_id, created_at DESC);  -- audit log page

-- Invites
CREATE INDEX idx_invites_org ON invites(org_id);
CREATE INDEX idx_invites_token ON invites(token);
CREATE INDEX idx_invites_email ON invites(email);
CREATE INDEX idx_invites_expires ON invites(expires_at);
CREATE INDEX idx_invites_pending ON invites(org_id, accepted_at) WHERE accepted_at IS NULL;

-- Sessions
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON sessions(refresh_token_hash);
CREATE INDEX idx_sessions_family ON sessions(token_family);
CREATE INDEX idx_sessions_active ON sessions(user_id, revoked) WHERE revoked = FALSE;
CREATE INDEX idx_sessions_expires ON sessions(expires_at) WHERE revoked = FALSE;
```

### Triggers

```sql
-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_domains_updated_at BEFORE UPDATE ON domains FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_domain_assignments_updated_at BEFORE UPDATE ON domain_assignments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_webhooks_updated_at BEFORE UPDATE ON webhooks FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-update search_vector on email insert/update
CREATE OR REPLACE FUNCTION update_email_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector = to_tsvector('english', COALESCE(NEW.subject, '') || ' ' || COALESCE(NEW.body_text, '') || ' ' || COALESCE(NEW.from_address, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_emails_search_vector BEFORE INSERT OR UPDATE ON emails FOR EACH ROW EXECUTE FUNCTION update_email_search_vector();
```

---

## RBAC & Permissions

### Role Definitions

```
System Level:
  system_admin → manage all orgs (superuser, set via is_system_admin flag)

Org Level:
  owner  → full org control, manage all settings, delete org
  admin  → manage teams, members, domains
  member → access assigned teams only, no org-level management

Team Level:
  lead   → manage team settings, domains, members
  member → create inboxes, view emails, use domains
  viewer → read-only access to inbox/email data
```

### Permission Matrix

```
Resource              Action            org:owner  org:admin  org:member  team:lead  team:member  team:viewer
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
Org                   read                 ✓          ✓          ✓
Org                   update               ✓          ✓
Org                   delete               ✓
Org.settings          manage               ✓          ✓
Org.members           invite               ✓          ✓
Org.members           remove               ✓          ✓
Org.members           change_role          ✓
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
Domain                create               ✓          ✓
Domain                read                 ✓          ✓          ✓          ✓          ✓           ✓ (*)
Domain                update               ✓          ✓
Domain                delete               ✓          ✓
Domain                verify               ✓          ✓
Domain                assign_to_team       ✓          ✓
Domain                unassign             ✓          ✓
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
Team                  create               ✓          ✓
Team                  read                 ✓          ✓          ✓          ✓          ✓           ✓
Team                  update               ✓          ✓                     ✓
Team                  delete               ✓          ✓
Team.members          invite               ✓          ✓                     ✓
Team.members          remove               ✓          ✓                     ✓
Team.members          change_role          ✓          ✓                     ✓
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
DomainAssignment      read                 ✓          ✓          ✓          ✓          ✓           ✓
DomainAssignment      update_settings      ✓          ✓                     ✓
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
Inbox                 create               ✓          ✓                     ✓          ✓                (**)
Inbox                 read (own only)      ✓          ✓                     ✓          ✓           ✓
Inbox                 extend_ttl (own)     ✓          ✓                     ✓          ✓
Inbox                 delete (own)         ✓          ✓                     ✓          ✓
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
Email                 read (own inbox)     ✓          ✓                     ✓          ✓           ✓
Email                 download_attach(own) ✓          ✓                     ✓          ✓
Email                 delete (own inbox)   ✓          ✓                     ✓          ✓
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
Webhook               create               ✓          ✓                     ✓
Webhook               read                 ✓          ✓                     ✓          ✓
Webhook               delete               ✓          ✓                     ✓
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
APIKey                create               ✓          ✓                     ✓
APIKey                read                 ✓          ✓                     ✓          ✓
APIKey                revoke               ✓          ✓                     ✓
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
Analytics             read                 ✓          ✓                     ✓          ✓           ✓
AuditLog              read                 ✓          ✓

(*) team roles only see domains assigned to their team
(**) inbox creation also gated by DomainAssignment.access_level >= create_inbox
All inbox/email operations are scoped to the creator only — no user can see another user's inboxes or emails.
```

### Two-Layer Authorization for Inbox Operations

1. **RBAC check**: Does the user's team role allow the action?
2. **Assignment check**: Does the team's domain assignment have sufficient `access_level`?
3. **Ownership check**: Is the user the creator of this inbox? (All inbox/email read/write operations require `created_by == current_user`)

All three must pass. Enforced in middleware.

---

## Settings Cascade

Resolution order (first explicit non-"inherit" value wins):

```
Domain Assignment settings
  → Domain settings
    → Org settings
      → System defaults (config.yaml)
```

### Configurable Settings

| Setting | Type | System Default | Configurable At |
|---|---|---|---|
| `attachments_enabled` | `inherit\|enabled\|disabled` | `enabled` | org, domain, team, assignment |
| `default_inbox_ttl` | duration | `10m` | org |
| `max_inbox_ttl` | duration | `24h` | org, assignment |
| `max_attachment_size_mb` | int | `25` | org |
| `max_domains` | int | `10` | org |
| `max_teams` | int | `50` | org |
| `max_inboxes_per_domain` | int | `100` | org |
| `enforce_sso` | bool | `false` | org |

---

## API Routes

### Auth

```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/forgot-password
POST   /api/v1/auth/reset-password
GET    /api/v1/auth/verify-email/:token           -- email verification
GET    /api/v1/auth/sso/:provider
GET    /api/v1/auth/sso/:provider/callback
GET    /api/v1/auth/me
PATCH  /api/v1/auth/me                          -- update profile (display_name, avatar_url)
PUT    /api/v1/auth/me/password                  -- change password (requires current password)
DELETE /api/v1/auth/me                           -- delete account (requires password confirmation)
GET    /api/v1/auth/sessions                     -- list active sessions
DELETE /api/v1/auth/sessions/:sessionId          -- revoke specific session
DELETE /api/v1/auth/sessions                     -- revoke all sessions
```

**Auth behavior notes:**
- `enforce_sso`: When enabled on an org, `POST /login` returns 403 for users who are members of that org with message "SSO login required". `POST /register` still works (user isn't in the org yet). The check happens after password verification.
- Email verification: On register, a verification email is sent. `email_verified` starts as `false`. Users can log in but see a banner "Please verify your email". SSO users are auto-verified. Configurable: system admin can disable email verification requirement in `config.yaml`.
- Password change: Updates `password_changed_at`, which invalidates all existing JWTs (middleware rejects tokens issued before this timestamp). All sessions except current are revoked.

### Organizations

```
POST   /api/v1/orgs
GET    /api/v1/orgs
GET    /api/v1/orgs/:orgId
PATCH  /api/v1/orgs/:orgId
DELETE /api/v1/orgs/:orgId
GET    /api/v1/orgs/:orgId/settings
PATCH  /api/v1/orgs/:orgId/settings
POST   /api/v1/orgs/:orgId/members
GET    /api/v1/orgs/:orgId/members
PATCH  /api/v1/orgs/:orgId/members/:userId
DELETE /api/v1/orgs/:orgId/members/:userId
POST   /api/v1/orgs/:orgId/invites
POST   /api/v1/invites/:token/accept
```

### Domains (org-level)

```
POST   /api/v1/orgs/:orgId/domains
GET    /api/v1/orgs/:orgId/domains
GET    /api/v1/domains/:domainId
PATCH  /api/v1/domains/:domainId
DELETE /api/v1/domains/:domainId
POST   /api/v1/domains/:domainId/verify
```

### Teams

```
POST   /api/v1/orgs/:orgId/teams
GET    /api/v1/orgs/:orgId/teams
GET    /api/v1/teams/:teamId
PATCH  /api/v1/teams/:teamId
DELETE /api/v1/teams/:teamId
POST   /api/v1/teams/:teamId/members
GET    /api/v1/teams/:teamId/members
PATCH  /api/v1/teams/:teamId/members/:userId
DELETE /api/v1/teams/:teamId/members/:userId
```

### Domain Assignments

```
POST   /api/v1/teams/:teamId/domains
GET    /api/v1/teams/:teamId/domains
PATCH  /api/v1/teams/:teamId/domains/:domainId
DELETE /api/v1/teams/:teamId/domains/:domainId
```

### Inboxes

```
POST   /api/v1/teams/:teamId/domains/:domainId/inboxes
GET    /api/v1/teams/:teamId/inboxes
GET    /api/v1/inboxes/:inboxId
PATCH  /api/v1/inboxes/:inboxId
DELETE /api/v1/inboxes/:inboxId
```

### Emails

```
GET    /api/v1/inboxes/:inboxId/emails
GET    /api/v1/emails/:emailId
PATCH  /api/v1/emails/:emailId                    -- mark read/unread
DELETE /api/v1/emails/:emailId
GET    /api/v1/emails/:emailId/attachments/:attachmentId
```

### Webhooks

```
POST   /api/v1/teams/:teamId/webhooks
GET    /api/v1/teams/:teamId/webhooks
PATCH  /api/v1/webhooks/:webhookId
DELETE /api/v1/webhooks/:webhookId
```

### API Keys

```
POST   /api/v1/teams/:teamId/api-keys
GET    /api/v1/teams/:teamId/api-keys
DELETE /api/v1/api-keys/:keyId
```

### Analytics & Audit

```
GET    /api/v1/orgs/:orgId/analytics
GET    /api/v1/teams/:teamId/analytics
GET    /api/v1/orgs/:orgId/audit-log
```

### Real-time & System

```
WS     /api/v1/ws/inboxes/:inboxId
WS     /api/v1/ws/notifications                  -- user-level push notifications
GET    /healthz
GET    /readyz
GET    /metrics
GET    /api/v1/docs                               -- Swagger UI
GET    /api/v1/docs/openapi.json                  -- OpenAPI spec
```

### System Admin (requires is_system_admin)

```
GET    /api/v1/admin/orgs                         -- list all orgs
GET    /api/v1/admin/stats                        -- global stats
GET    /api/v1/admin/health                       -- system health (DB, Redis, SMTP)
```

---

## Frontend Page Map

```
/                                    → Landing page (marketing, features)
/login                               → Login (email/pass + SSO buttons)
/register                            → Registration form
/forgot-password                     → Password reset request
/invite/:token                       → Accept invite
/verify-email/:token                 → Email verification
/profile                             → User profile (display name, avatar, change password)
/profile/sessions                    → Active sessions management
/profile/delete                      → Account deletion

/dashboard                           → Org switcher, overview stats, recent activity

/orgs/:orgId                         → Org overview (domains, teams, usage stats)
/orgs/:orgId/domains                 → Domain management (add, verify, settings)
/orgs/:orgId/domains/:domainId       → Domain detail (DNS status, assigned teams, settings)
/orgs/:orgId/teams                   → Teams list
/orgs/:orgId/members                 → Org member management
/orgs/:orgId/settings                → Org settings dashboard (all configurable settings)
/orgs/:orgId/audit-log               → Audit log (filterable table)
/orgs/:orgId/analytics               → Org-level analytics charts

/teams/:teamId                       → Team overview (assigned domains, inboxes, members)
/teams/:teamId/domains               → Team's assigned domains + inboxes per domain
/teams/:teamId/members               → Team member management
/teams/:teamId/webhooks              → Webhook management
/teams/:teamId/api-keys              → API key management
/teams/:teamId/settings              → Team settings
/teams/:teamId/analytics             → Team-level analytics charts

/inbox/:inboxId                      → Real-time inbox view (split pane)
/email/:emailId                      → Full email detail + attachments

/admin                               → System admin dashboard (is_system_admin only)
```

### UI/UX Patterns

- **Inbox view**: Split pane — list left, preview right. WebSocket real-time. Countdown timer. Copy address button.
- **Domain verification**: Step-by-step wizard with copy-paste DNS records and auto-polling status.
- **Member management**: Table with inline role dropdown, invite modal, confirmation dialogs.
- **Settings pages**: Inline save with optimistic UI. Toggles, sliders, inputs with units.
- **Dark/light mode**: System preference default, manual toggle.
- **Command palette**: Cmd+K for quick navigation.
- **Responsive**: Mobile-friendly for quick inbox checks.
- **Breadcrumbs**: Org → Team → Domain → Inbox navigation.
- **Skeleton loaders**: On all data-fetching pages.
- **Empty states**: Illustrations with clear CTAs.
- **Toast notifications**: Sonner for all mutations.

---

## Build Phases & Feature Branches

---

### Phase 1 — Foundation

#### feature/001-project-skeleton

- [ ] `.gitignore` — Go, Node, IDE, env, binaries, MinIO data
- [ ] `.env.example` — documented environment variables (DB URL, Redis URL, MinIO credentials, JWT secret, SMTP config, SSO provider credentials)
- [ ] `go.mod` + `go.sum` — module `gitlab.com/amjaradat01/burnerbyte`
- [ ] `cmd/api/main.go` — HTTP server entrypoint with graceful shutdown (SIGINT/SIGTERM)
- [ ] `cmd/smtpd/main.go` — SMTP server entrypoint with graceful shutdown
- [ ] `internal/config/config.go` — config struct loaded from env + `config.yaml` via Viper
- [ ] `config.yaml` — default config: DB, Redis, MinIO, SMTP (inbound), mailer (outbound SMTP sender), quotas, feature flags, all settings defaults
- [ ] `docker-compose.yml` — PostgreSQL 16, Redis 7, MinIO (with healthchecks)
- [ ] `Makefile` — targets: `run-api`, `run-smtp`, `migrate-up`, `migrate-down`, `migrate-create`, `migrate-test` (run up then down for each migration), `build`, `lint`, `docker-up`, `docker-down`
- [ ] `Dockerfile` — multi-stage build for Go API + SMTP binaries
- [ ] `Dockerfile.frontend` — multi-stage build for Next.js
- [ ] `README.md` — project overview, architecture diagram, setup instructions
- [ ] Chi router setup with middleware stack: structured logging, panic recovery, CORS, request ID, real IP
- [ ] Structured JSON logging via `log/slog` with request ID propagation
- [ ] `GET /healthz` — liveness probe (always 200)
- [ ] `GET /readyz` — readiness probe (checks DB + Redis connectivity)
- [ ] `GET /metrics` — Prometheus metrics endpoint
- [ ] Project directory structure created (all `internal/` subdirectories)

#### feature/002-database-schema

- [ ] `internal/database/postgres.go` — PostgreSQL connection pool setup (`pgxpool`) with config, `WithTx(ctx, fn)` transaction helper that begins tx, executes fn, commits/rolls back
- [ ] `internal/database/redis.go` — Redis connection setup (`go-redis/v9`) with config
- [ ] `internal/storage/s3.go` — MinIO/S3 client initialization with config
- [ ] Migration tooling setup (`golang-migrate`) integrated into Makefile
- [ ] Migration 001: `users` table with indexes
- [ ] Migration 002: `organizations` table with indexes
- [ ] Migration 003: `org_memberships` table with indexes + unique constraint
- [ ] Migration 004: `teams` table with indexes + unique(org_id, slug)
- [ ] Migration 005: `team_memberships` table with indexes + unique constraint
- [ ] Migration 006: `domains` table with indexes + unique(domain_name)
- [ ] Migration 007: `domain_assignments` table with indexes + unique(team_id, domain_id)
- [ ] Migration 008: `inboxes` table with indexes
- [ ] Migration 009: `emails` table with indexes + GIN index on search_vector + trigger for tsvector update
- [ ] Migration 010: `attachments` table with indexes
- [ ] Migration 011: `webhooks` table with indexes
- [ ] Migration 012: `webhook_delivery_logs` table with indexes
- [ ] Migration 013: `api_keys` table with indexes
- [ ] Migration 014: `audit_logs` table with indexes (append-only, no FK cascade delete)
- [ ] Migration 015: `invites` table with indexes
- [ ] Migration 016: `sessions` table with indexes
- [ ] Migration 017: `update_updated_at()` trigger function + apply to all tables with `updated_at`
- [ ] Migration 018: `update_email_search_vector()` trigger function + apply to emails table
- [ ] All foreign keys, CHECK constraints, and NOT NULL constraints as defined in data model

---

### Phase 2 — Auth & Core CRUD

#### feature/003-auth-system

- [ ] `internal/auth/password.go` — bcrypt hash + verify functions
- [ ] `internal/auth/jwt.go` — generate access token (15min), refresh token (7d), validate, extract claims. JWT payload: `sub` (user_id), `email`, `is_system_admin`, `iat`, `exp`. No org/team info in JWT — looked up per-request from DB for freshness.
- [ ] `internal/auth/middleware.go` — JWT extraction from Authorization header, user context injection into request. Reject tokens issued before `password_changed_at` (forces re-login after password change).
- [ ] `internal/auth/sso.go` — OIDC provider config, redirect URL generation, callback handler, user upsert
- [ ] `internal/mailer/mailer.go` — outbound email service: configurable SMTP sender (host, port, username, password, from address, TLS). Used for sending invite links, password reset links, and account lockout notifications. Config loaded from `config.yaml` under `mailer:` section. Includes HTML email templates (embedded via `embed` package). Falls back to logging the link to stdout if mailer is not configured (for development).
- [ ] `internal/domain/user.go` — User struct, CreateUserInput, LoginInput, TokenPair types
- [ ] `internal/repository/postgres/user_repo.go` — Create, GetByID, GetByEmail, GetBySSO, Update, Delete
- [ ] `internal/repository/postgres/session_repo.go` — Create, GetByID, GetByTokenHash, ListByUser, Revoke, RevokeAll, RevokeByFamily, DeleteExpired
- [ ] `internal/service/auth_service.go` — Register (validate, hash, create, send verification email, return tokens), Login (verify password, check lockout, check email_verified, check enforce_sso, return tokens), Refresh (rotate token, check family reuse), SSO flow (auto-verify email), ForgotPassword, ResetPassword (update password_changed_at), VerifyEmail
- [ ] `internal/handler/auth.go` — POST register, POST login, POST refresh, POST forgot-password, POST reset-password, GET sso/:provider, GET sso/:provider/callback, GET me, PATCH me (update profile), PUT me/password (change password), GET verify-email/:token
- [ ] Rate limiting on auth endpoints: 5 attempts per minute per IP for login, 3 per hour for forgot-password
- [ ] Account lockout: lock account for 15 minutes after 5 consecutive failed login attempts, store attempt count in Redis, return 423 Locked with retry-after header
- [ ] Password policy enforcement: minimum 8 characters, at least 1 uppercase, 1 lowercase, 1 number, 1 special character. Validate on register, reset-password, and change-password endpoints
- [ ] Refresh token rotation: on each refresh, invalidate the old refresh token and issue a new pair. Store refresh token family in PostgreSQL `sessions` table to detect reuse (if old token is reused, revoke entire family — indicates token theft)
- [ ] Session management: `internal/auth/session.go` — track active sessions (refresh tokens) per user in PostgreSQL `sessions` table with metadata (IP, user agent, created_at, last_used_at). Redis used only for login attempt counts and lockout state (fast expiring counters).
- [ ] `GET /api/v1/auth/sessions` — list user's active sessions
- [ ] `DELETE /api/v1/auth/sessions/:sessionId` — revoke specific session
- [ ] `DELETE /api/v1/auth/sessions` — revoke all sessions (log out everywhere)
- [ ] `DELETE /api/v1/auth/me` — account deletion: cascade delete all user data (inboxes, emails, memberships), require password confirmation
- [ ] Input validation on all endpoints (email format, password policy, etc.)
- [ ] Wire auth routes into Chi router

#### feature/004-org-management

- [ ] `internal/domain/org.go` — Organization, OrgMembership, OrgSettings, OrgInvite structs
- [ ] `internal/repository/postgres/org_repo.go` — Org CRUD + OrgMembership CRUD + invite token storage
- [ ] `internal/service/org_service.go` — CreateOrg (creator=owner), UpdateOrg, DeleteOrg, GetOrg, ListUserOrgs, InviteMember (generate token, store), AcceptInvite, RemoveMember, ChangeRole, UpdateSettings
- [ ] `internal/handler/org.go` — all org endpoints as defined in API routes
- [ ] Org settings: full JSONB management, validate setting values against allowed ranges
- [ ] Invite system: generate expiring token (48h), accept endpoint creates membership
- [ ] Slug auto-generation from name (with uniqueness check)
- [ ] Wire org routes with JWT auth middleware

#### feature/005-domain-management

- [ ] `internal/domain/domain.go` — Domain struct, CreateDomainInput, DomainSettings types
- [ ] `internal/repository/postgres/domain_repo.go` — Create, GetByID, GetByName, ListByOrg, Update, Delete, UpdateDNSStatus
- [ ] `internal/service/domain_service.go` — AddDomain (validate uniqueness, check org quota), UpdateSettings, Delete, TriggerVerify
- [ ] `internal/handler/domain.go` — all domain endpoints
- [ ] `internal/dns/verifier.go` — LookupMX (check domain's MX points to expected host), LookupTXT (check for verification TXT record), full verification flow
- [ ] Domain settings: attachment policy (inherit/enabled/disabled)
- [ ] Enforce max_domains quota from org settings
- [ ] Wire domain routes with JWT auth middleware

#### feature/006-team-management

- [ ] `internal/domain/team.go` — Team, TeamMembership, TeamSettings structs
- [ ] `internal/repository/postgres/team_repo.go` — Team CRUD + TeamMembership CRUD
- [ ] `internal/service/team_service.go` — CreateTeam (check org quota), UpdateTeam, DeleteTeam, ListByOrg, AddMember, RemoveMember, ChangeRole, UpdateSettings
- [ ] `internal/handler/team.go` — all team endpoints
- [ ] Team settings: attachment policy, max inbox TTL override
- [ ] Enforce max_teams quota from org settings
- [ ] Slug auto-generation with uniqueness within org
- [ ] Wire team routes with JWT auth middleware

#### feature/007-rbac-engine

- [ ] `internal/rbac/roles.go` — Role type constants for org and team levels
- [ ] `internal/rbac/permissions.go` — Permission struct (Resource, Action), static RolePermissions map covering entire permission matrix
- [ ] `internal/rbac/enforcer.go` — `Enforce(ctx, userID, resource, action, resourceIDs) error` — resolves user's role for the target resource via DB lookups, checks against permission map
- [ ] `internal/auth/middleware.go` — add RBAC middleware functions: `RequireOrgRole(resource, action)`, `RequireTeamRole(resource, action)`, `RequireDomainAssignment(minAccessLevel)`
- [ ] Middleware extracts orgId/teamId from URL params, resolves membership, calls enforcer
- [ ] Wire RBAC middleware into ALL existing org, team, domain handlers (retrofit)
- [ ] System admin bypass: if `user.is_system_admin == true`, skip RBAC checks
- [ ] Rate limit response headers on all API responses: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (Unix timestamp)

#### feature/008-domain-assignment

- [ ] `internal/domain/assignment.go` — DomainAssignment struct, AccessLevel type, AssignmentSettings
- [ ] `internal/repository/postgres/domain_assignment_repo.go` — Create, GetByID, GetByTeamAndDomain, ListByTeam, ListByDomain, Update, Delete
- [ ] `internal/service/domain_assignment_service.go` — AssignDomain (validate domain verified, no duplicate), Unassign, UpdateAccessLevel, UpdateSettings
- [ ] `internal/handler/domain_assignment.go` — all assignment endpoints
- [ ] `internal/service/settings_resolver.go` — `ResolveSetting(assignmentID, key)` — walks assignment → domain → org → system default, returns first explicit value
- [ ] Wire assignment routes with RBAC middleware (org:owner/admin can assign, team:lead can update settings)

---

### Phase 3 — Email Core

#### feature/009-inbox-system

- [ ] `pkg/randaddr/generator.go` — generate random address (configurable length 6-12, alphanumeric lowercase)
- [ ] `internal/domain/inbox.go` — Inbox struct, CreateInboxInput (optional custom alias)
- [ ] `internal/repository/postgres/inbox_repo.go` — Create, GetByID, GetByFullAddress, ListByAssignment, ListByTeam, Delete, ExtendTTL
- [ ] `internal/repository/redis/inbox_repo.go` — Set inbox key with TTL (for fast SMTP lookups), Get, Delete
- [ ] `internal/service/inbox_service.go` — CreateInbox (check RBAC + assignment access_level >= create_inbox, check quota, resolve TTL settings, generate or validate custom alias, store in PG + Redis), ExtendTTL (owner only, validate against max), Delete (owner only), List (only current user's inboxes, filtered by team/domain)
- [ ] `internal/handler/inbox.go` — all inbox endpoints, enforce created_by == current_user on all read/write ops
- [ ] Two-layer auth: RBAC role check + domain assignment access_level check
- [ ] Enforce max_inboxes_per_domain quota from org settings

#### feature/010-smtp-server

- [ ] `internal/smtp/server.go` — SMTP server setup using `go-guerrilla`, TLS config, port config (25, 587)
- [ ] `internal/smtp/handler.go` — implement `guerrilla.Processor`: accept connection, parse RCPT TO, extract local part + domain
- [ ] `internal/smtp/router.go` — lookup domain in DB → lookup inbox by full_address in Redis → accept (250) or reject (550)
- [ ] MIME parsing with `jhillyerd/enmime` — extract subject, from, to, text body, HTML body, headers, attachments
- [ ] SPF validation on incoming connections using `net` stdlib DNS lookups
- [ ] Connection rate limiting: max 50 connections per source IP per minute
- [ ] Configurable max email size (from config, default 10MB)
- [ ] Internal email processing queue: buffered Go channel (configurable size, default 1000). SMTP handler enqueues parsed emails, worker pool dequeues and stores. If channel full, return SMTP 451 (try again later) — sender will retry per SMTP spec.
- [ ] Pass parsed email to email storage service (feature/011)

#### feature/011-email-storage

- [ ] `internal/domain/email.go` — Email struct, EmailSummary (for list view), SearchInput
- [ ] `internal/repository/postgres/email_repo.go` — Create, GetByID, ListByInbox (paginated), Delete, Search (full-text via tsvector)
- [ ] `internal/repository/redis/email_repo.go` — Store email body with TTL matching inbox, Get, Delete
- [ ] `internal/service/email_service.go` — StoreEmail (from SMTP handler: save metadata to PG, body to Redis with TTL, update search_vector), GetEmail, ListByInbox, Search, Delete, MarkRead/Unread
- [ ] `internal/handler/email.go` — all email endpoints including PATCH for read/unread status
- [ ] Spam score calculation: basic SPF pass/fail scoring + header analysis (missing headers, suspicious patterns)
- [ ] Full-text search on subject + body_text using PostgreSQL tsvector

#### feature/012-attachments

- [ ] `internal/storage/s3.go` — Upload (put object), Download (generate presigned URL with expiry), Delete, ListByPrefix
- [ ] `internal/domain/attachment.go` — Attachment struct
- [ ] `internal/repository/postgres/attachment_repo.go` — Create, GetByID, ListByEmail, Delete
- [ ] `internal/service/attachment_service.go` — StoreAttachment (resolve attachment policy via settings cascade, if disabled discard, check size against max, upload to MinIO, save metadata), GetDownloadURL (presigned), DeleteByEmail
- [ ] Integration into SMTP handler: after parsing email, if has attachments → call attachment service
- [ ] `GET /emails/:emailId/attachments/:attachmentId` — returns presigned download URL
- [ ] Cleanup: when email expires/deleted, delete associated S3 objects

---

### Phase 4 — Platform Features

#### feature/013-webhooks

- [ ] `internal/domain/webhook.go` — Webhook struct, WebhookEvent type, DeliveryLog struct
- [ ] `internal/repository/postgres/webhook_repo.go` — Create, GetByID, ListByTeam, Update, Delete, LogDelivery, GetDeliveryLogs
- [ ] `internal/service/webhook_service.go` — Create (validate URL), Update, Delete, List, TriggerEvent
- [ ] `internal/handler/webhook.go` — all webhook endpoints
- [ ] `internal/webhook/dispatcher.go` — async delivery: HMAC-SHA256 signing with webhook secret, POST payload, retry 3 times with exponential backoff (1s, 5s, 25s), update delivery log
- [ ] Events: `email.received`, `inbox.created`, `inbox.expired`
- [ ] Payload format: `{ event, timestamp, data: { ... } }` with `X-BurnerByte-Signature` header
- [ ] Integration: SMTP handler triggers `email.received`, inbox service triggers `inbox.created`

#### feature/014-api-keys

- [ ] `internal/domain/apikey.go` — APIKey struct, CreateAPIKeyInput, Scope type
- [ ] `internal/repository/postgres/apikey_repo.go` — Create, GetByHash, ListByTeam, Delete, UpdateLastUsed
- [ ] `internal/service/apikey_service.go` — Generate (create random key `bb_` prefix + 32 random bytes, SHA-256 hash stored, raw returned once), Revoke, List, ValidateAndResolve
- [ ] `internal/handler/apikey.go` — all API key endpoints
- [ ] `internal/auth/middleware.go` — add API key auth: check `Authorization: Bearer bb_...` header, lookup by hash, validate scopes, inject user context
- [ ] Scopes: `inbox:create`, `inbox:read`, `email:read`, `email:delete`
- [ ] Key expiry: reject expired keys on validation
- [ ] Dual auth support: middleware tries JWT first, falls back to API key
- [ ] OpenAPI 3.0 spec: auto-generate from handler annotations using `swaggo/swag`, serve at `GET /api/v1/docs` (Swagger UI) and `GET /api/v1/docs/openapi.json` (raw spec). Document all endpoints, request/response schemas, auth methods, error codes
- [ ] Webhook signature verification documented in OpenAPI spec: HMAC-SHA256 with `X-BurnerByte-Signature` header, include code examples for consumers

#### feature/015-audit-log

- [ ] `internal/domain/audit.go` — AuditEntry struct, AuditFilter struct
- [ ] `internal/repository/postgres/audit_repo.go` — Create (append-only), List (paginated, filterable by actor, action, resource_type, date range)
- [ ] `internal/service/audit_service.go` — Record (actor, action, resource_type, resource_id, metadata, IP), List with filters
- [ ] `internal/handler/audit.go` — GET audit log endpoint with query params for filtering
- [ ] `internal/audit/recorder.go` — helper middleware/function to auto-record on mutating operations, extracts actor from context, IP from request
- [ ] Integrate audit recording into ALL existing mutating handlers: org (create, update, delete, member changes), team (same), domain (create, delete, verify, assign/unassign), inbox (create, delete), webhook (create, delete), apikey (create, revoke)
- [ ] Audit events list: `org.created`, `org.updated`, `org.deleted`, `org.settings.updated`, `member.invited`, `member.removed`, `member.role_changed`, `team.created`, `team.updated`, `team.deleted`, `domain.created`, `domain.deleted`, `domain.verified`, `domain.assigned`, `domain.unassigned`, `inbox.created`, `inbox.deleted`, `inbox.extended`, `webhook.created`, `webhook.deleted`, `apikey.created`, `apikey.revoked`

#### feature/016-analytics

- [ ] `internal/domain/analytics.go` — AnalyticsData struct, OrgStats, TeamStats, TimeSeriesPoint
- [ ] `internal/repository/postgres/analytics_repo.go` — aggregate queries: emails per day/week/month, active inboxes count, storage used, top sender domains, emails per domain, attachment count/size
- [ ] `internal/service/analytics_service.go` — GetOrgAnalytics (date range), GetTeamAnalytics (date range)
- [ ] `internal/handler/analytics.go` — GET org analytics, GET team analytics (with date range query params)
- [ ] `internal/worker/analytics.go` — background job: runs hourly, pre-computes and caches aggregate stats in Redis for fast dashboard loading
- [ ] Analytics data: emails_received (time series), active_inboxes (time series), storage_used_bytes, top_sender_domains (top 10), emails_per_domain, attachment_count, attachment_total_size
- [ ] `internal/handler/admin.go` — system admin endpoints: GET /admin/orgs (list all orgs with stats), GET /admin/stats (global totals: users, orgs, emails, inboxes, storage), GET /admin/health (DB ping, Redis ping, SMTP listener status). Protected by `is_system_admin` middleware check.
- [ ] `internal/repository/postgres/admin_repo.go` — global aggregate queries for system admin dashboard

#### feature/017-websocket-realtime

- [ ] `internal/handler/ws.go` — WebSocket upgrade handler for `/ws/inboxes/:inboxId`
- [ ] JWT validation on WebSocket handshake (token passed as query param or first message)
- [ ] RBAC check: verify user has read access to the inbox's team
- [ ] `internal/realtime/hub.go` — connection hub: register/unregister clients, per-inbox channels, broadcast to all clients watching an inbox
- [ ] Integration: SMTP handler → after storing email → push to hub → broadcast to connected WebSocket clients
- [ ] Message format: `{ type: "email.received", data: { emailId, from, subject, receivedAt } }`
- [ ] Heartbeat: server sends ping every 30s, client must pong within 10s or disconnect
- [ ] SSE fallback: `GET /api/v1/sse/inboxes/:inboxId` for clients that don't support WebSocket
- [ ] User notification WebSocket: `WS /api/v1/ws/notifications` — per-user channel, pushes events: `email.received` (for any of user's active inboxes), `domain.verified`, `invite.received`. Frontend notification center subscribes to this.
- [ ] Graceful shutdown: close all connections on server stop

#### feature/018-background-workers

- [ ] `internal/worker/manager.go` — worker manager: start/stop workers gracefully, configurable intervals, context cancellation
- [ ] `internal/worker/dns_recheck.go` — re-verify DNS for all domains every 6 hours, update mx_verified/txt_verified, log failures
- [ ] `internal/worker/cleanup.go` — delete expired inboxes from PostgreSQL (Redis handles its own TTL), delete associated S3 attachments, run every 5 minutes
- [ ] `internal/worker/webhook_retry.go` — retry failed webhook deliveries (failure_count < 3), run every minute
- [ ] `internal/worker/reconciler.go` — Redis ↔ PostgreSQL sync: on startup and every 1 minute, query active inboxes from PG, ensure corresponding Redis keys exist with correct TTL, re-populate any missing keys
- [ ] All workers run inside `cmd/api` process (no separate binary)
- [ ] Workers log start/stop/errors via slog
- [ ] Configurable intervals via config.yaml

---

### Phase 5 — Frontend

#### feature/019-frontend-shell

- [ ] Next.js 14+ project in `web/` directory (App Router, TypeScript, Tailwind CSS)
- [ ] pnpm setup with `pnpm-workspace.yaml` if needed
- [ ] shadcn/ui initialization + install all needed components (button, input, select, dialog, dropdown-menu, table, card, badge, tabs, separator, skeleton, avatar, command, toast, sheet, popover, calendar, switch, slider, textarea, label, form)
- [ ] `web/src/lib/api.ts` — API client with base URL config, JWT interceptor (attach token), auto-refresh on 401, error handling
- [ ] `web/src/stores/auth-store.ts` — Zustand: user, tokens, login/logout/refresh actions
- [ ] `web/src/stores/ui-store.ts` — Zustand: sidebar open/closed, theme, command palette open
- [ ] `web/src/components/layout/app-shell.tsx` — main layout: sidebar + top bar + content area
- [ ] `web/src/components/layout/sidebar.tsx` — navigation: org switcher, teams, domains, settings, audit, analytics
- [ ] `web/src/components/layout/top-bar.tsx` — breadcrumbs, user avatar dropdown (profile, theme toggle, logout)
- [ ] `web/src/components/layout/breadcrumbs.tsx` — auto-generated from route
- [ ] `web/src/components/ui/command-palette.tsx` — Cmd+K: search orgs, teams, domains, inboxes
- [ ] `web/src/components/ui/loading-skeleton.tsx` — reusable skeleton components for cards, tables, lists
- [ ] `web/src/components/ui/empty-state.tsx` — reusable empty state with illustration and CTA
- [ ] `web/src/components/ui/confirm-dialog.tsx` — reusable confirmation dialog for destructive actions
- [ ] Dark mode / light mode: system preference default, manual toggle, persisted in localStorage
- [ ] Responsive design: sidebar collapses to sheet on mobile
- [ ] Protected route wrapper: redirect to `/login` if no valid token
- [ ] Sonner toast provider in root layout
- [ ] TanStack Query provider in root layout
- [ ] Global error boundary
- [ ] `web/src/hooks/use-keyboard-shortcuts.ts` — global keyboard shortcut handler: `n` (new inbox), `j/k` (navigate email list), `d` (delete selected), `Escape` (close modals/panels), `?` (show shortcut help overlay)
- [ ] `web/src/components/ui/shortcut-help.tsx` — keyboard shortcut help overlay (triggered by `?`)
- [ ] `web/src/components/ui/notification-center.tsx` — in-app notification dropdown in top bar: new email received (when user is on a different page), domain verified, invite received. Uses WebSocket connection to receive push notifications. Badge count for unread notifications. Mark as read/dismiss.

#### feature/020-frontend-auth-pages

- [ ] `web/src/app/(auth)/login/page.tsx` — email/password form + SSO provider buttons (Google, etc.)
- [ ] `web/src/app/(auth)/register/page.tsx` — registration form (name, email, password, confirm password)
- [ ] `web/src/app/(auth)/forgot-password/page.tsx` — email input, submit, success message
- [ ] `web/src/app/(auth)/reset-password/page.tsx` — new password form (from token in URL)
- [ ] `web/src/app/(auth)/invite/[token]/page.tsx` — accept invite page (show org name, accept button, auto-login)
- [ ] `web/src/app/(auth)/verify-email/[token]/page.tsx` — email verification: auto-verifies on load, shows success/error, redirect to dashboard
- [ ] `web/src/app/(app)/profile/page.tsx` — user profile: edit display name, avatar upload, change password form (current + new + confirm, with password policy indicator), SSO connection status
- [ ] `web/src/app/(app)/profile/sessions/page.tsx` — active sessions list: IP, user agent (browser/OS parsed), last active time, current session badge, "Revoke" button per session, "Revoke all other sessions" button
- [ ] `web/src/app/(app)/profile/delete/page.tsx` — account deletion: warning text, require password confirmation, type "DELETE" to confirm, cascade explanation (all inboxes, emails, memberships will be removed)
- [ ] All forms: React Hook Form + Zod validation schemas
- [ ] JWT storage in httpOnly cookie (set via API response) or secure localStorage
- [ ] Auto-redirect to `/dashboard` after successful login/register
- [ ] Auth layout: centered card, clean design, logo at top

#### feature/021-frontend-org-dashboard

- [ ] `web/src/app/(app)/dashboard/page.tsx` — org switcher dropdown, overview cards per org (domain count, team count, active inboxes, emails today), recent activity feed
- [ ] `web/src/app/(app)/orgs/[orgId]/page.tsx` — org overview: stats cards, quick action buttons (add domain, create team, invite member)
- [ ] `web/src/app/(app)/orgs/[orgId]/members/page.tsx` — member table: avatar, name, email, role badge, joined date, actions dropdown (change role, remove)
- [ ] Invite modal: email input + role selector (owner/admin/member) + send button
- [ ] Role change: inline dropdown with confirmation dialog
- [ ] Member removal: confirmation dialog with member name
- [ ] Pagination on member list
- [ ] Search/filter members by name or email
- [ ] Onboarding wizard: shown on first login when user has no orgs. Step-by-step flow: create org (name) → add domain (domain name) → DNS verification instructions (MX/TXT records, copy buttons) → create team (name) → assign domain to team → create first inbox → done. Skippable at any step. Progress indicator. Stores completion state in localStorage.
- [ ] System admin dashboard (`/admin`): only visible if `user.is_system_admin`. Lists all orgs (name, member count, domain count, created date), global stats (total users, total orgs, total emails received, total active inboxes, storage used), system health (DB connection, Redis connection, SMTP status). Protected by `is_system_admin` check.

#### feature/022-frontend-domain-management

- [ ] `web/src/app/(app)/orgs/[orgId]/domains/page.tsx` — domain list: domain name, verification status badge (verified/pending/failed), assigned teams count, settings summary, actions
- [ ] Add domain modal: domain name input with validation
- [ ] `web/src/app/(app)/orgs/[orgId]/domains/[domainId]/page.tsx` — domain detail page:
  - DNS verification wizard: step 1 (show MX record to add, copy button) → step 2 (show TXT record, copy button) → step 3 (verify button, auto-poll status every 30s while on page)
  - Verification status with last checked timestamp
  - Domain settings panel: attachment policy toggle (inherit/enabled/disabled), inline save
  - Assigned teams list: team name, access level badge, settings overrides, unassign button
  - Assign to team modal: team selector dropdown + access level picker (full/create_inbox/read_only)
- [ ] Delete domain: confirmation dialog warning about cascading deletes

#### feature/023-frontend-team-management

- [ ] `web/src/app/(app)/orgs/[orgId]/teams/page.tsx` — team cards: name, member count, domain count, active inboxes
- [ ] Create team modal: name input
- [ ] `web/src/app/(app)/teams/[teamId]/page.tsx` — team overview: assigned domains with inbox counts, member list summary, recent emails
- [ ] `web/src/app/(app)/teams/[teamId]/members/page.tsx` — team member management (same pattern as org members, team roles: lead/member/viewer)
- [ ] `web/src/app/(app)/teams/[teamId]/domains/page.tsx` — team's assigned domains: domain name, access level badge, active inboxes count, "Create Inbox" button per domain
- [ ] `web/src/app/(app)/teams/[teamId]/settings/page.tsx` — team settings: attachment policy, max inbox TTL
- [ ] Delete team: confirmation dialog

#### feature/024-frontend-inbox-view

- [ ] Inbox creation flow: click "Create Inbox" on team domain page → modal with random address preview + option to set custom alias + TTL selector (dropdown: 5m, 10m, 30m, 1h, 6h, 12h, 24h) → create → redirect to inbox view
- [ ] `web/src/app/(app)/inbox/[inboxId]/page.tsx` — THE MAIN VIEW:
  - Split pane layout (resizable): inbox email list on left, email preview on right
  - Email list: sender avatar/initial, from address, subject (truncated), received time (relative), unread dot indicator
  - Email preview: from, to, subject, date, HTML body rendered in sandboxed iframe, text fallback tab. Auto-marks email as read when previewed (PATCH call).
  - Prominent copy-to-clipboard button for the email address (top of page)
  - Countdown timer showing time remaining until inbox expires
  - "Extend" button to add more time (dropdown with duration options)
  - Real-time updates via WebSocket: new emails slide in with subtle animation at top of list
  - Empty state: illustration + "Waiting for emails... Send something to {address}"
  - Search bar: filter emails by subject/sender within this inbox
  - Delete email button in preview
- [ ] `web/src/hooks/use-websocket.ts` — WebSocket hook: connect, reconnect on disconnect, parse messages, update TanStack Query cache
- [ ] Mobile: stacked layout (list view, tap to open email full screen, back button)

#### feature/025-frontend-email-view

- [ ] `web/src/app/(app)/email/[emailId]/page.tsx` — full email detail page (for deep linking / standalone view):
  - Header section: from, to, subject, date, spam score indicator (low/medium/high with color)
  - Body tabs: "HTML" (rendered in sandboxed iframe with srcdoc), "Plain Text", "Raw Headers" (expandable JSON)
  - Attachment list: filename, size, content type icon, download button (fetches presigned URL)
  - Delete email button with confirmation
  - Back to inbox link
- [ ] `web/src/components/email/email-body-renderer.tsx` — safe HTML rendering in sandboxed iframe, strips scripts, handles inline images
- [ ] `web/src/components/email/attachment-list.tsx` — attachment cards with download action

#### feature/026-frontend-settings-pages

- [ ] `web/src/app/(app)/orgs/[orgId]/settings/page.tsx` — THE ORG OWNER CONTROL PANEL:
  - Organization info section: name, slug (read-only), logo upload
  - Inbox defaults section:
    - Default inbox TTL (dropdown: 5m, 10m, 30m, 1h, 6h, 12h, 24h)
    - Max inbox TTL (dropdown, must be >= default)
  - Attachments section:
    - Enable/disable attachments (toggle switch)
    - Max attachment size MB (number input with stepper)
  - Quotas section:
    - Max domains (number input)
    - Max teams (number input)
    - Max inboxes per domain (number input)
  - Security section:
    - Enforce SSO-only login (toggle switch with warning)
  - Danger zone section:
    - Delete organization (red button, confirmation dialog with org name typed to confirm)
  - All settings: inline save with optimistic UI, success toast, revert on error
- [ ] Domain settings: inline on domain detail page (feature/022)
- [ ] Team settings: dedicated page (feature/023)
- [ ] Domain assignment settings: inline on domain detail page under assigned teams section

#### feature/027-frontend-webhooks-apikeys

- [ ] `web/src/app/(app)/teams/[teamId]/webhooks/page.tsx`:
  - Webhook list: URL (truncated), events badges, active/inactive toggle, last status badge, failure count
  - Create webhook modal: URL input, secret (auto-generated, copyable), event checkboxes (email.received, inbox.created, inbox.expired)
  - Edit webhook: update URL, events, active status
  - Delete webhook: confirmation dialog
  - Expandable delivery log per webhook: timestamp, status code, response time, success/failure badge
- [ ] `web/src/app/(app)/teams/[teamId]/api-keys/page.tsx`:
  - API key list: name, prefix (`bb_a8xk...`), scopes badges, created date, last used date, expires date
  - Create API key modal: name input, scope checkboxes (inbox:create, inbox:read, email:read, email:delete), expiry selector (30d, 90d, 1y, never)
  - On creation: show raw key ONCE in a modal with copy button + warning "This key won't be shown again"
  - Revoke key: confirmation dialog

#### feature/028-frontend-audit-analytics

- [ ] `web/src/app/(app)/orgs/[orgId]/audit-log/page.tsx`:
  - Filterable table: date/time, actor (avatar + name), action (badge), resource type, resource name/ID
  - Filters: actor dropdown, action type dropdown, resource type dropdown, date range picker
  - Expandable rows: show full metadata JSON, IP address
  - Pagination
  - Export to CSV button
- [ ] `web/src/app/(app)/orgs/[orgId]/analytics/page.tsx` + `web/src/app/(app)/teams/[teamId]/analytics/page.tsx`:
  - Date range selector (last 7d, 30d, 90d, custom)
  - Emails received over time (line chart — Recharts)
  - Active inboxes over time (area chart)
  - Emails per domain (horizontal bar chart)
  - Top sender domains (pie/donut chart)
  - Attachment stats: count, total size (stat cards)
  - Storage usage (progress bar / gauge)
  - All charts: loading skeletons, empty states, responsive

---

### Phase 6 — Release

#### release/v0.1.0

- [ ] Merge `develop` → `release/v0.1.0` branch
- [ ] End-to-end testing: register → create org → add domain → verify → create team → assign domain → create inbox → receive email via SMTP → view in UI → WebSocket real-time → attachments → webhooks → API keys → audit log → analytics
- [ ] Update `README.md`: full setup guide (prerequisites, docker-compose up, config, first run), screenshots of key UI pages, API documentation overview
- [ ] Create `CHANGELOG.md` with all features in v0.1.0
- [ ] Create `LICENSE` file (Apache 2.0)
- [ ] Create `CONTRIBUTING.md` with development setup and git flow instructions
- [ ] Merge `release/v0.1.0` → `main`
- [ ] Merge `release/v0.1.0` → `develop` (back-merge)
- [ ] Tag `v0.1.0` on `main`
- [ ] Push all branches and tags to remote

---

## Project Directory Structure

```
burnerbyte/
├── cmd/
│   ├── api/main.go                    # HTTP API + background workers
│   └── smtpd/main.go                 # SMTP server
├── internal/
│   ├── config/config.go               # Viper config loading
│   ├── database/
│   │   ├── postgres.go                # pgxpool setup
│   │   └── redis.go                   # go-redis setup
│   ├── storage/s3.go                  # MinIO/S3 client
│   ├── auth/
│   │   ├── jwt.go                     # Token generation/validation
│   │   ├── password.go                # bcrypt helpers
│   │   ├── session.go                 # Session tracking/management
│   │   ├── sso.go                     # OIDC handlers
│   │   └── middleware.go              # Auth + RBAC middleware
│   ├── rbac/
│   │   ├── roles.go                   # Role constants
│   │   ├── permissions.go             # Permission map
│   │   └── enforcer.go               # Permission checking
│   ├── domain/                        # Business types (structs)
│   │   ├── user.go
│   │   ├── org.go
│   │   ├── team.go
│   │   ├── domain.go
│   │   ├── assignment.go
│   │   ├── inbox.go
│   │   ├── email.go
│   │   ├── attachment.go
│   │   ├── webhook.go
│   │   ├── apikey.go
│   │   ├── audit.go
│   │   └── analytics.go
│   ├── repository/
│   │   ├── postgres/                  # All PostgreSQL repos
│   │   └── redis/                     # All Redis repos
│   ├── service/                       # Business logic
│   │   ├── auth_service.go
│   │   ├── org_service.go
│   │   ├── team_service.go
│   │   ├── domain_service.go
│   │   ├── domain_assignment_service.go
│   │   ├── settings_resolver.go
│   │   ├── inbox_service.go
│   │   ├── email_service.go
│   │   ├── attachment_service.go
│   │   ├── webhook_service.go
│   │   ├── apikey_service.go
│   │   ├── audit_service.go
│   │   └── analytics_service.go
│   ├── handler/                       # HTTP handlers
│   │   ├── auth.go
│   │   ├── org.go
│   │   ├── team.go
│   │   ├── domain.go
│   │   ├── domain_assignment.go
│   │   ├── inbox.go
│   │   ├── email.go
│   │   ├── webhook.go
│   │   ├── apikey.go
│   │   ├── audit.go
│   │   ├── analytics.go
│   │   ├── admin.go                   # System admin endpoints
│   │   └── ws.go
│   ├── smtp/
│   │   ├── server.go                  # go-guerrilla setup
│   │   ├── handler.go                 # Email processing
│   │   └── router.go                  # Inbox routing
│   ├── dns/verifier.go                # MX/TXT verification
│   ├── webhook/dispatcher.go          # Async webhook delivery
│   ├── realtime/hub.go                # WebSocket hub
│   ├── audit/recorder.go              # Audit recording helper
│   ├── mailer/
│   │   ├── mailer.go                  # SMTP sender
│   │   └── templates/                 # Embedded HTML email templates
│   │       ├── invite.html
│   │       ├── verify_email.html
│   │       ├── password_reset.html
│   │       └── lockout.html
│   └── worker/
│       ├── manager.go                 # Worker lifecycle
│       ├── dns_recheck.go
│       ├── cleanup.go
│       ├── webhook_retry.go
│       ├── reconciler.go              # Redis ↔ PG sync
│       └── analytics.go
├── pkg/
│   └── randaddr/generator.go          # Random address generation
├── migrations/                        # SQL migration files
│   ├── 001_users.up.sql / .down.sql
│   ├── ...
│   └── 018_email_search_trigger.up.sql / .down.sql
├── web/                               # Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── (auth)/               # Auth pages (login, register, etc.)
│   │   │   └── (app)/                # Authenticated pages
│   │   ├── components/
│   │   │   ├── ui/                   # shadcn components
│   │   │   ├── layout/              # Shell, sidebar, breadcrumbs
│   │   │   ├── inbox/               # Inbox list, email preview
│   │   │   ├── domain/              # Verification wizard
│   │   │   ├── email/               # Body renderer, attachment list
│   │   │   └── org/                 # Member table, settings forms
│   │   ├── hooks/                    # useWebSocket, useAuth, useRBAC
│   │   ├── lib/                      # API client, utils
│   │   ├── stores/                   # Zustand stores
│   │   └── types/                    # TypeScript types
│   ├── public/
│   ├── tailwind.config.ts
│   ├── next.config.ts
│   └── package.json
├── config.yaml                        # Default configuration
├── .env.example                       # Environment variable template
├── docker-compose.yml
├── Dockerfile
├── Dockerfile.frontend
├── Makefile
├── BUILDPLAN.md                       # This file
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE                            # Apache 2.0
└── go.mod
```

---

## Release Checklist

### Cross-Cutting Concerns (applied across ALL features)

These are NOT separate feature branches. They are requirements that must be satisfied
within every relevant feature branch as it is built.

- **Pagination**: All list endpoints return paginated responses (`page`, `per_page` query params, response includes `total`, `page`, `per_page`, `total_pages`). Frontend tables/lists use pagination components.
- **Input validation**: All API endpoints validate request bodies. Return 400 with structured error response `{ error: string, details: [{ field, message }] }`.
- **Error responses**: Consistent JSON error format across all endpoints: `{ error: string, code: string, details?: any }`. HTTP status codes: 400 (validation), 401 (unauthenticated), 403 (forbidden/RBAC), 404 (not found), 409 (conflict/duplicate), 429 (rate limited), 500 (internal).
- **Request/response types**: All request/response bodies use consistent JSON naming (snake_case). All timestamps are ISO 8601 / RFC 3339.
- **Pagination on frontend**: All list pages (members, domains, teams, inboxes, emails, webhooks, API keys, audit log) must have pagination controls.
- **Search/filter on frontend**: Member lists (search by name/email), email lists (search by subject/sender), audit log (filter by actor/action/resource/date), domain list (search by name).
- **Loading states**: Every data-fetching page/component shows skeleton loaders while loading.
- **Error states**: Every data-fetching page/component shows error state with retry button on failure.
- **Optimistic updates**: All mutation operations (create, update, delete) use optimistic UI via TanStack Query cache updates, with rollback on error.
- **Confirmation dialogs**: All destructive actions (delete org, remove member, revoke key, delete domain, etc.) require confirmation.
- **Toast notifications**: All mutations show success/error toasts via Sonner.
- **Rate limiting (API-wide)**: Global rate limit middleware: 100 requests/min per authenticated user, 20 requests/min per unauthenticated IP. Configurable in config.yaml. All responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers. Return 429 with `Retry-After` header when exceeded.
- **Request logging**: All API requests logged with method, path, status, duration, request ID, user ID (if authenticated).
- **CORS**: Configurable allowed origins in config.yaml. Default: `http://localhost:3000` for development.
- **Database transactions**: All multi-step mutations must be wrapped in a PostgreSQL transaction. Use a `WithTx(ctx, fn)` helper that begins a transaction, executes the function, commits on success, rolls back on error. Examples: create org + owner membership, delete team + cascade assignments, store email + attachments metadata. Repository methods must accept a `pgx.Tx` or use the transaction from context.
- **Redis ↔ PostgreSQL consistency**: PostgreSQL is the source of truth. Write to PostgreSQL first (inside transaction), then write to Redis. If Redis write fails, log the error but don't roll back PG — a background worker reconciles by syncing missing Redis keys from PG on startup and periodically (every 1 minute). SMTP lookups that miss in Redis fall back to a PG query and re-populate Redis.
- **Conflict handling**: All unique constraint violations (duplicate email, duplicate domain, duplicate alias) must return 409 Conflict with a clear error message, not 500. Repository layer catches `pgx` unique violation errors and returns a typed `ErrConflict`.
- **Idempotency**: Webhook delivery uses idempotency keys (event ID + webhook ID) to prevent duplicate delivery on retry. Invite acceptance is idempotent (accepting twice returns success, doesn't create duplicate membership).
- **SMTP backpressure**: Inbound SMTP handler uses a buffered Go channel (configurable size, default 1000) as an internal queue. SMTP goroutine enqueues parsed emails, a pool of worker goroutines dequeues and stores. If the channel is full, SMTP returns 451 (try again later) to the sending server — standard SMTP flow, the sender will retry.
- **Migration safety**: All down migrations must be tested. Migrations must be backward-compatible (no column renames or drops without a two-phase approach). Add `migrate-test` Makefile target that runs up then down for each migration.

---

### Pre-release (on release branch)

- [ ] All feature branches merged to develop
- [ ] All endpoints return correct HTTP status codes
- [ ] All RBAC permissions enforced correctly
- [ ] Settings cascade resolves correctly at all levels
- [ ] SMTP server accepts and routes emails correctly
- [ ] WebSocket delivers real-time updates
- [ ] Attachments upload/download works with policy enforcement
- [ ] Webhooks fire and retry correctly
- [ ] API keys authenticate and scope correctly
- [ ] Audit log records all mutating operations
- [ ] Analytics queries return correct aggregations
- [ ] All list endpoints return paginated responses
- [ ] All error responses follow consistent format
- [ ] Rate limiting works on auth and API endpoints
- [ ] Frontend renders all pages correctly
- [ ] Dark/light mode works
- [ ] Mobile responsive layout works
- [ ] No console errors in frontend
- [ ] Docker compose brings up full stack

### Release (merge to main + tag)

- [ ] `CHANGELOG.md` updated
- [ ] `README.md` updated with screenshots
- [ ] Version tag created: `git tag -a v0.1.0 -m "Initial release"`
- [ ] Pushed: `git push origin main --tags`
