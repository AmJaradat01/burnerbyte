BEGIN;

DELETE FROM role_permissions
WHERE permission_id IN (SELECT id FROM permissions WHERE scope = 'team' AND key = 'team.emails.manage');

DELETE FROM permissions WHERE scope = 'team' AND key = 'team.emails.manage';

COMMIT;
