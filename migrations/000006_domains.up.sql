CREATE TABLE domains (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    domain_name         VARCHAR(255) UNIQUE NOT NULL,
    mx_verified         BOOLEAN NOT NULL DEFAULT FALSE,
    txt_verified        BOOLEAN NOT NULL DEFAULT FALSE,
    dns_last_checked_at TIMESTAMPTZ,
    settings            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_domains_org ON domains(org_id);
CREATE INDEX idx_domains_name ON domains(domain_name);
CREATE INDEX idx_domains_mx_verified ON domains(org_id, mx_verified);
