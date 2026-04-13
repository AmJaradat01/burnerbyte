-- Revert viewer role: update existing viewers to member, then alter constraints
UPDATE team_memberships SET role = 'member' WHERE role = 'viewer';
UPDATE invites SET team_role = 'member' WHERE team_role = 'viewer';

ALTER TABLE team_memberships DROP CONSTRAINT IF EXISTS team_memberships_role_check;
ALTER TABLE team_memberships ADD CONSTRAINT team_memberships_role_check CHECK (role IN ('lead', 'member'));

ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_team_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_team_role_check CHECK (team_role IN ('lead', 'member'));

-- Drop indexes
DROP INDEX IF EXISTS idx_teams_name_trgm;
DROP INDEX IF EXISTS idx_teams_org_archived;

-- Remove columns
ALTER TABLE teams
    DROP COLUMN IF EXISTS archived_at,
    DROP COLUMN IF EXISTS is_archived,
    DROP COLUMN IF EXISTS avatar_url,
    DROP COLUMN IF EXISTS description;
