CREATE TABLE sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash  TEXT NOT NULL,
    token_family        UUID NOT NULL,
    ip_address          INET,
    user_agent          TEXT,
    last_used_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,
    revoked             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON sessions(refresh_token_hash);
CREATE INDEX idx_sessions_family ON sessions(token_family);
CREATE INDEX idx_sessions_active ON sessions(user_id, revoked) WHERE revoked = FALSE;
CREATE INDEX idx_sessions_expires ON sessions(expires_at) WHERE revoked = FALSE;
