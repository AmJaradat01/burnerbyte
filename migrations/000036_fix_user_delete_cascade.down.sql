-- Revert foreign key constraints back to original (no cascade)
-- Note: This does NOT restore NOT NULL constraints that were dropped

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_created_by_fkey;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_revoked_by_fkey;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES users(id);

ALTER TABLE webhooks DROP CONSTRAINT IF EXISTS webhooks_created_by_fkey;
ALTER TABLE webhooks ADD CONSTRAINT webhooks_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_id_fkey;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES users(id);

ALTER TABLE domain_assignments DROP CONSTRAINT IF EXISTS domain_assignments_assigned_by_fkey;
ALTER TABLE domain_assignments ADD CONSTRAINT domain_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES users(id);

ALTER TABLE inboxes DROP CONSTRAINT IF EXISTS inboxes_created_by_fkey;
ALTER TABLE inboxes ADD CONSTRAINT inboxes_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);

ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_invited_by_fkey;
ALTER TABLE invites ADD CONSTRAINT invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES users(id);

ALTER TABLE setup_state DROP CONSTRAINT IF EXISTS setup_state_completed_by_fkey;
ALTER TABLE setup_state ADD CONSTRAINT setup_state_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES users(id);
