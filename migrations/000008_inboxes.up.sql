CREATE TABLE inboxes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_assignment_id    UUID NOT NULL REFERENCES domain_assignments(id) ON DELETE CASCADE,
    domain_id               UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    created_by              UUID NOT NULL REFERENCES users(id),
    address                 VARCHAR(64) NOT NULL,
    full_address            VARCHAR(320) UNIQUE NOT NULL,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at              TIMESTAMPTZ NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inboxes_assignment ON inboxes(domain_assignment_id);
CREATE INDEX idx_inboxes_domain ON inboxes(domain_id);
CREATE INDEX idx_inboxes_full_address ON inboxes(full_address);
CREATE INDEX idx_inboxes_created_by ON inboxes(created_by);
CREATE INDEX idx_inboxes_expires ON inboxes(expires_at) WHERE is_active = TRUE;
CREATE INDEX idx_inboxes_active ON inboxes(domain_id, is_active) WHERE is_active = TRUE;
