-- Remove SSO provider name from sessions
ALTER TABLE sessions DROP COLUMN IF EXISTS sso_provider_name;

-- Remove deprecated column comments
COMMENT ON COLUMN users.sso_provider IS NULL;
COMMENT ON COLUMN users.sso_subject IS NULL;

-- Drop new tables
DROP TABLE IF EXISTS user_sso_identities;
DROP TABLE IF EXISTS sso_providers;
