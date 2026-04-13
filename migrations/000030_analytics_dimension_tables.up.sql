-- Persistent dimension tables for analytics that survive email deletion

-- Hourly email volume (for peak hours chart)
CREATE TABLE hourly_email_stats (
    org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    date             DATE NOT NULL,
    hour             INT NOT NULL CHECK (hour >= 0 AND hour <= 23),
    emails_received  INT NOT NULL DEFAULT 0,
    PRIMARY KEY (org_id, date, hour)
);

-- Per-receiving-domain email volume (for domain breakdown chart)
CREATE TABLE daily_domain_email_stats (
    org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    date             DATE NOT NULL,
    domain_name      TEXT NOT NULL,
    emails_received  INT NOT NULL DEFAULT 0,
    PRIMARY KEY (org_id, date, domain_name)
);

-- Per-sender-domain email volume (for top sender domains)
CREATE TABLE daily_sender_domain_stats (
    org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    date             DATE NOT NULL,
    sender_domain    TEXT NOT NULL,
    emails_received  INT NOT NULL DEFAULT 0,
    PRIMARY KEY (org_id, date, sender_domain)
);

-- Team-level daily stats (for team emails-per-day chart)
CREATE TABLE daily_team_email_stats (
    team_id          UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    date             DATE NOT NULL,
    emails_received  INT NOT NULL DEFAULT 0,
    inboxes_created  INT NOT NULL DEFAULT 0,
    storage_bytes    BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (team_id, date)
);

-- Team-level all-time counters (for team total emails card)
CREATE TABLE team_analytics_counters (
    team_id                UUID PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
    total_emails_received  BIGINT NOT NULL DEFAULT 0,
    total_inboxes_created  BIGINT NOT NULL DEFAULT 0,
    total_storage_bytes    BIGINT NOT NULL DEFAULT 0,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed team counters for existing teams
INSERT INTO team_analytics_counters (team_id)
SELECT id FROM teams
ON CONFLICT DO NOTHING;
