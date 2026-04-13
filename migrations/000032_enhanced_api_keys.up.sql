-- Add new columns to api_keys table
ALTER TABLE api_keys
    ADD COLUMN description TEXT,
    ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN revoked_at TIMESTAMPTZ,
    ADD COLUMN revoked_by UUID REFERENCES users(id),
    ADD COLUMN request_count BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN last_used_ip TEXT,
    ADD COLUMN allowed_ips JSONB;

-- Index for filtering active keys
CREATE INDEX idx_api_keys_is_active ON api_keys(is_active);

-- Index for filtering/querying revoked keys
CREATE INDEX idx_api_keys_revoked_at ON api_keys(revoked_at);
