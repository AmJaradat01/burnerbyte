-- Platform-level audit events (registration, login, password reset, account
-- deletion, session revocation) have no owning organization and were recorded
-- with org_id = uuid.Nil, which violated the NOT NULL + FK constraint and
-- caused those security-relevant events to silently fail to persist. Allow a
-- NULL org_id so org-less platform events are recorded. The FK already permits
-- NULL (NULL never violates a foreign key).
ALTER TABLE audit_logs ALTER COLUMN org_id DROP NOT NULL;
