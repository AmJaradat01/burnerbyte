CREATE TABLE team_memberships (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    role        VARCHAR(20) NOT NULL CHECK (role IN ('lead', 'member', 'viewer')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, team_id)
);

CREATE INDEX idx_team_memberships_user ON team_memberships(user_id);
CREATE INDEX idx_team_memberships_team ON team_memberships(team_id);
CREATE INDEX idx_team_memberships_team_role ON team_memberships(team_id, role);
