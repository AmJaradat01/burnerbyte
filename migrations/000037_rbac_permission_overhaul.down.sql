-- RBAC Permission Overhaul: rollback
-- Remove newly added permissions, viewer role, and their role_permission entries

BEGIN;

-- ============================================================
-- 1. Delete role_permissions for the newly added permissions
--    (this covers assignments to owner, admin, member, lead, member, viewer)
-- ============================================================
DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE key IN (
        'org.analytics.view',
        'org.settings.view',
        'org.members.view',
        'org.members.add',
        'org.teams.create',
        'org.teams.delete',
        'org.audit.export',
        'org.domains.view',
        'team.view',
        'team.members.view',
        'team.members.role',
        'team.domains.view',
        'team.webhooks.view',
        'team.apikeys.view',
        'team.inboxes.view',
        'team.inboxes.create',
        'team.analytics.view'
    )
);

-- ============================================================
-- 2. Delete newly added permission keys
-- ============================================================
DELETE FROM permissions WHERE key IN (
    'org.analytics.view',
    'org.settings.view',
    'org.members.view',
    'org.members.add',
    'org.teams.create',
    'org.teams.delete',
    'org.audit.export',
    'org.domains.view',
    'team.view',
    'team.members.view',
    'team.members.role',
    'team.domains.view',
    'team.webhooks.view',
    'team.apikeys.view',
    'team.inboxes.view',
    'team.inboxes.create',
    'team.analytics.view'
);

COMMIT;
