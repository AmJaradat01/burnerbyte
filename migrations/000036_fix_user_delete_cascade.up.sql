-- Fix foreign key constraints that block user deletion
-- These are "created_by" / "assigned_by" / "actor_id" reference fields
-- that should SET NULL when the referenced user is deleted, not block deletion.

-- api_keys.created_by
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_created_by_fkey;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE api_keys ALTER COLUMN created_by DROP NOT NULL;

-- api_keys.revoked_by (already nullable)
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_revoked_by_fkey;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL;

-- webhooks.created_by
ALTER TABLE webhooks DROP CONSTRAINT IF EXISTS webhooks_created_by_fkey;
ALTER TABLE webhooks ADD CONSTRAINT webhooks_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE webhooks ALTER COLUMN created_by DROP NOT NULL;

-- audit_logs.actor_id (already nullable)
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_id_fkey;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;

-- domain_assignments.assigned_by (already nullable)
ALTER TABLE domain_assignments DROP CONSTRAINT IF EXISTS domain_assignments_assigned_by_fkey;
ALTER TABLE domain_assignments ADD CONSTRAINT domain_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL;

-- inboxes.created_by
ALTER TABLE inboxes DROP CONSTRAINT IF EXISTS inboxes_created_by_fkey;
ALTER TABLE inboxes ADD CONSTRAINT inboxes_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE inboxes ALTER COLUMN created_by DROP NOT NULL;

-- invites.invited_by (already nullable)
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_invited_by_fkey;
ALTER TABLE invites ADD CONSTRAINT invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL;

-- setup_state.completed_by (already nullable)
ALTER TABLE setup_state DROP CONSTRAINT IF EXISTS setup_state_completed_by_fkey;
ALTER TABLE setup_state ADD CONSTRAINT setup_state_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL;
