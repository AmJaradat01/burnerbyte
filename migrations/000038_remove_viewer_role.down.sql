-- Re-create the viewer team role with read-only permissions
BEGIN;

INSERT INTO roles (scope, value, label, description, rank, is_system)
VALUES ('team', 'viewer', 'Viewer', 'Read-only access to team resources', 0, TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.scope = 'team' AND r.value = 'viewer'
  AND p.scope = 'team'
  AND p.key IN (
    'team.view',
    'team.members.view',
    'team.domains.view',
    'team.webhooks.view',
    'team.apikeys.view',
    'team.inboxes.view',
    'team.emails.view',
    'team.analytics.view'
  )
ON CONFLICT DO NOTHING;

COMMIT;
