-- Enhanced domains: add description, spf_verified, trigram index, verification history table

ALTER TABLE domains ADD COLUMN description TEXT;
ALTER TABLE domains ADD COLUMN spf_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_domains_name_trgm ON domains USING GIN (domain_name gin_trgm_ops);

CREATE TABLE domain_verification_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id       UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    mx_result       BOOLEAN NOT NULL,
    txt_result      BOOLEAN NOT NULL,
    spf_result      BOOLEAN NOT NULL,
    trigger_source  VARCHAR(20) NOT NULL,
    error_details   TEXT
);

CREATE INDEX idx_verification_history_domain_time ON domain_verification_history(domain_id, checked_at DESC);
