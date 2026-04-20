-- Drop sso_domain_mappings table and its indexes
DROP TABLE IF EXISTS sso_domain_mappings;

-- Drop invite_team_assignments table and its indexes
DROP TABLE IF EXISTS invite_team_assignments;

-- Remove allowed_auth column from invites
ALTER TABLE invites DROP COLUMN IF EXISTS allowed_auth;
