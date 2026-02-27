CREATE TABLE domain_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    domain_id       UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    access_level    VARCHAR(20) NOT NULL CHECK (access_level IN ('full', 'create_inbox', 'read_only')),
    settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
    assigned_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(team_id, domain_id)
);

CREATE INDEX idx_domain_assignments_team ON domain_assignments(team_id);
CREATE INDEX idx_domain_assignments_domain ON domain_assignments(domain_id);
