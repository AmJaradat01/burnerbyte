DROP INDEX IF EXISTS idx_api_keys_revoked_at;
DROP INDEX IF EXISTS idx_api_keys_is_active;

ALTER TABLE api_keys
    DROP COLUMN IF EXISTS allowed_ips,
    DROP COLUMN IF EXISTS last_used_ip,
    DROP COLUMN IF EXISTS request_count,
    DROP COLUMN IF EXISTS revoked_by,
    DROP COLUMN IF EXISTS revoked_at,
    DROP COLUMN IF EXISTS is_active,
    DROP COLUMN IF EXISTS description;
