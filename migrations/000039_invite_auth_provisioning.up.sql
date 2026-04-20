-- Add allowed_auth column to invites table (JSONB array of permitted auth methods)
ALTER TABLE invites ADD COLUMN IF NOT EXISTS allowed_auth JSONB DEFAULT '["any"]'::jsonb;

-- Create invite_team_assignments table for multi-team invite support
CREATE TABLE IF NOT EXISTS invite_team_assignments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invite_id  UUID NOT NULL REFERENCES invites(id) ON DELETE CASCADE,
    team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    team_role  VARCHAR(50) NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(invite_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_invite_team_assignments_invite ON invite_team_assignments(invite_id);
CREATE INDEX IF NOT EXISTS idx_invite_team_assignments_team ON invite_team_assignments(team_id);

-- Create sso_domain_mappings table for domain-based auto-provisioning with multi-team support
CREATE TABLE IF NOT EXISTS sso_domain_mappings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES sso_providers(id) ON DELETE CASCADE,
    domain      VARCHAR(255) NOT NULL,
    org_role    VARCHAR(50) NOT NULL DEFAULT 'member',
    team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    team_role   VARCHAR(50) NOT NULL DEFAULT 'member',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(provider_id, domain, team_id)
);

CREATE INDEX IF NOT EXISTS idx_sso_domain_mappings_provider ON sso_domain_mappings(provider_id);
CREATE INDEX IF NOT EXISTS idx_sso_domain_mappings_domain ON sso_domain_mappings(domain);
