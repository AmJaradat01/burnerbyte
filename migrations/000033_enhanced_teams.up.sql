-- Enable pg_trgm extension for trigram search (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add new columns to teams table
ALTER TABLE teams
    ADD COLUMN description TEXT,
    ADD COLUMN avatar_url TEXT,
    ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN archived_at TIMESTAMPTZ;

-- Index for filtered team listing by org and archived status
CREATE INDEX idx_teams_org_archived ON teams(org_id, is_archived);

-- GIN trigram index for case-insensitive name search
CREATE INDEX idx_teams_name_trgm ON teams USING GIN (name gin_trgm_ops);

-- Re-add viewer role to team_memberships CHECK constraint
ALTER TABLE team_memberships DROP CONSTRAINT IF EXISTS team_memberships_role_check;
ALTER TABLE team_memberships ADD CONSTRAINT team_memberships_role_check CHECK (role IN ('lead', 'member', 'viewer'));

-- Re-add viewer role to invites CHECK constraint
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_team_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_team_role_check CHECK (team_role IN ('lead', 'member', 'viewer'));
