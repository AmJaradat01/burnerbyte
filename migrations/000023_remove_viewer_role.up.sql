-- Remove viewer role: update any existing viewers to member, then alter constraints
UPDATE team_memberships SET role = 'member' WHERE role = 'viewer';
UPDATE invites SET team_role = 'member' WHERE team_role = 'viewer';

ALTER TABLE team_memberships DROP CONSTRAINT IF EXISTS team_memberships_role_check;
ALTER TABLE team_memberships ADD CONSTRAINT team_memberships_role_check CHECK (role IN ('lead', 'member'));

ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_team_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_team_role_check CHECK (team_role IN ('lead', 'member'));
