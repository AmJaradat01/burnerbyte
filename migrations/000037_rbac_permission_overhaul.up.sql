-- RBAC Permission Overhaul: add missing permissions, viewer role, and role-permission assignments
-- All inserts use ON CONFLICT DO NOTHING for idempotency

BEGIN;

-- ============================================================
-- 1. Add missing org-scoped permissions
-- ============================================================
INSERT INTO permissions (scope, key, label, description) VALUES
    ('org', 'org.analytics.view', 'View organization analytics', ''),
    ('org', 'org.settings.view', 'View organization settings', ''),
    ('org', 'org.members.view', 'View organization members', ''),
    ('org', 'org.members.add', 'Directly add members to organization', ''),
    ('org', 'org.teams.create', 'Create teams', ''),
    ('org', 'org.teams.delete', 'Delete and archive teams', ''),
    ('org', 'org.teams.manage', 'Manage teams (archive, restore, impact)', ''),
    ('org', 'org.audit.export', 'Export audit logs', ''),
    ('org', 'org.domains.view', 'View domains list', '')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. Add missing team-scoped permissions
-- ============================================================
INSERT INTO permissions (scope, key, label, description) VALUES
    ('team', 'team.view', 'View team information', ''),
    ('team', 'team.members.view', 'View team members', ''),
    ('team', 'team.members.role', 'Change team member roles', ''),
    ('team', 'team.domains.view', 'View domain assignments', ''),
    ('team', 'team.webhooks.view', 'View webhooks and delivery logs', ''),
    ('team', 'team.apikeys.view', 'View API keys', ''),
    ('team', 'team.inboxes.view', 'View team inboxes', ''),
    ('team', 'team.inboxes.create', 'Create inboxes', ''),
    ('team', 'team.analytics.view', 'View team analytics', '')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. Assign ALL org permissions to owner role (owner gets everything)
-- ============================================================
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.scope = 'org' AND r.value = 'owner'
  AND p.scope = 'org'
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. Assign appropriate org permissions to admin role (all except org.delete)
-- ============================================================
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.scope = 'org' AND r.value = 'admin'
  AND p.scope = 'org'
  AND p.key != 'org.delete'
ON CONFLICT DO NOTHING;

-- ============================================================
-- 5. Assign read-only org permissions to member role
-- ============================================================
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.scope = 'org' AND r.value = 'member'
  AND p.scope = 'org'
  AND p.key IN ('org.view', 'org.settings.view', 'org.members.view', 'org.domains.view', 'org.analytics.view')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 6. Assign ALL team permissions to lead role
-- ============================================================
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.scope = 'team' AND r.value = 'lead'
  AND p.scope = 'team'
ON CONFLICT DO NOTHING;

-- ============================================================
-- 7. Assign team permissions to member role:
--    all view permissions + team.inboxes.create, team.inboxes.manage, team.emails.view
-- ============================================================
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.scope = 'team' AND r.value = 'member'
  AND p.scope = 'team'
  AND p.key IN (
    'team.view',
    'team.members.view',
    'team.domains.view',
    'team.webhooks.view',
    'team.apikeys.view',
    'team.inboxes.view',
    'team.inboxes.create',
    'team.inboxes.manage',
    'team.emails.view',
    'team.analytics.view'
  )
ON CONFLICT DO NOTHING;

COMMIT;
