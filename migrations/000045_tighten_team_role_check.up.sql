-- Tighten team role CHECK constraints: viewer role was removed in migration
-- 000038 from the roles table, but the CHECK constraints on team_memberships
-- and invites still allow 'viewer'. Clean up any stray viewer rows and narrow
-- the constraints to match the current role set.

-- First update any stray viewer memberships to member (should be none after 038)
UPDATE team_memberships SET role = 'member' WHERE role = 'viewer';
UPDATE invites SET team_role = 'member' WHERE team_role = 'viewer';

-- Drop and re-add constraints without viewer
ALTER TABLE team_memberships DROP CONSTRAINT IF EXISTS team_memberships_role_check;
ALTER TABLE team_memberships ADD CONSTRAINT team_memberships_role_check CHECK (role IN ('lead', 'member'));

ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_team_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_team_role_check CHECK (team_role IN ('lead', 'member'));
