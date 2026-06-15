-- Restore NOT NULL. Platform-level (org-less) rows cannot satisfy it, so they
-- are removed first.
DELETE FROM audit_logs WHERE org_id IS NULL;
ALTER TABLE audit_logs ALTER COLUMN org_id SET NOT NULL;
