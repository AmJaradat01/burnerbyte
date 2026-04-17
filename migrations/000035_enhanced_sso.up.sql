-- SSO provider configurations (multi-provider support)
CREATE TABLE sso_providers (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  VARCHAR(50) UNIQUE NOT NULL,
    provider_type         VARCHAR(20) NOT NULL, -- google, github, azure, okta, oidc
    client_id             VARCHAR(255) NOT NULL,
    client_secret_encrypted TEXT NOT NULL,
    redirect_url          TEXT NOT NULL,
    issuer_url            TEXT,
    tenant_id             VARCHAR(255),
    auto_provision        BOOLEAN NOT NULL DEFAULT FALSE,
    default_org_role      VARCHAR(50) DEFAULT 'member',
    default_team_role     VARCHAR(50) DEFAULT 'member',
    allowed_domains       TEXT,
    claim_mappings        JSONB DEFAULT '[]',
    custom_claims         JSONB DEFAULT '[]',
    enabled               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User SSO identities (multi-provider per user)
CREATE TABLE user_sso_identities (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider      VARCHAR(50) NOT NULL,
    subject       VARCHAR(255) NOT NULL,
    email         VARCHAR(255),
    display_name  VARCHAR(255),
    metadata      JSONB DEFAULT '{}',
    linked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(provider, subject)
);

CREATE INDEX idx_user_sso_identities_user_id ON user_sso_identities(user_id);
CREATE INDEX idx_user_sso_identities_provider_subject ON user_sso_identities(provider, subject);

-- Migrate existing SSO data from users table to user_sso_identities
INSERT INTO user_sso_identities (id, user_id, provider, subject, email, display_name, linked_at, last_used_at)
SELECT gen_random_uuid(), u.id, u.sso_provider, u.sso_subject, u.email, u.display_name, u.created_at, u.updated_at
FROM users u
WHERE u.sso_provider IS NOT NULL AND u.sso_subject IS NOT NULL;

-- Add SSO provider name to sessions for session binding
ALTER TABLE sessions ADD COLUMN sso_provider_name VARCHAR(50);

-- Comment deprecated columns (cannot drop for backward compatibility)
COMMENT ON COLUMN users.sso_provider IS 'DEPRECATED: Use user_sso_identities table instead';
COMMENT ON COLUMN users.sso_subject IS 'DEPRECATED: Use user_sso_identities table instead';
