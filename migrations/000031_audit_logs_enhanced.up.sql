-- Add new columns with safe defaults for backward compatibility
ALTER TABLE audit_logs ADD COLUMN user_agent TEXT DEFAULT '';
ALTER TABLE audit_logs ADD COLUMN resource_name TEXT DEFAULT '';
ALTER TABLE audit_logs ADD COLUMN actor_display_name TEXT DEFAULT '';
ALTER TABLE audit_logs ADD COLUMN severity VARCHAR(20) DEFAULT 'info';
ALTER TABLE audit_logs ADD COLUMN category VARCHAR(30) DEFAULT '';

-- Indexes for filtered queries
CREATE INDEX idx_audit_logs_severity ON audit_logs(severity);
CREATE INDEX idx_audit_logs_category ON audit_logs(category);
CREATE INDEX idx_audit_logs_resource_name ON audit_logs(resource_name);
