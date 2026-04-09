CREATE TABLE org_analytics_counters (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  total_emails_received BIGINT NOT NULL DEFAULT 0,
  total_inboxes_created BIGINT NOT NULL DEFAULT 0,
  total_storage_bytes BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE daily_email_stats (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  emails_received INT NOT NULL DEFAULT 0,
  inboxes_created INT NOT NULL DEFAULT 0,
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, date)
);

-- Seed counters for existing orgs
INSERT INTO org_analytics_counters (org_id)
SELECT id FROM organizations
ON CONFLICT DO NOTHING;
