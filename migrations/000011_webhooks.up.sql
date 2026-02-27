CREATE TABLE webhooks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_by      UUID NOT NULL REFERENCES users(id),
    url             TEXT NOT NULL,
    secret          VARCHAR(255) NOT NULL,
    events          JSONB NOT NULL,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    last_status     INT,
    last_attempt_at TIMESTAMPTZ,
    failure_count   INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhooks_team ON webhooks(team_id);
CREATE INDEX idx_webhooks_active ON webhooks(team_id, active) WHERE active = TRUE;
