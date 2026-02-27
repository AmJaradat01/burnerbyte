CREATE TABLE invites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    team_id     UUID REFERENCES teams(id) ON DELETE CASCADE,
    email       VARCHAR(255) NOT NULL,
    org_role    VARCHAR(20) NOT NULL CHECK (org_role IN ('owner', 'admin', 'member')),
    team_role   VARCHAR(20) CHECK (team_role IN ('lead', 'member', 'viewer')),
    token       VARCHAR(255) UNIQUE NOT NULL,
    invited_by  UUID REFERENCES users(id),
    accepted_at TIMESTAMPTZ,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invites_org ON invites(org_id);
CREATE INDEX idx_invites_token ON invites(token);
CREATE INDEX idx_invites_email ON invites(email);
CREATE INDEX idx_invites_expires ON invites(expires_at);
CREATE INDEX idx_invites_pending ON invites(org_id, accepted_at) WHERE accepted_at IS NULL;
