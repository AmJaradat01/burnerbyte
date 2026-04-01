ALTER TABLE team_memberships DROP CONSTRAINT IF EXISTS team_memberships_role_check;
ALTER TABLE team_memberships ADD CONSTRAINT team_memberships_role_check CHECK (role IN ('lead', 'member', 'viewer'));

ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_team_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_team_role_check CHECK (team_role IN ('lead', 'member', 'viewer'));
