DROP INDEX IF EXISTS idx_audit_logs_resource_name;
DROP INDEX IF EXISTS idx_audit_logs_category;
DROP INDEX IF EXISTS idx_audit_logs_severity;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS category;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS severity;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS actor_display_name;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS resource_name;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS user_agent;
