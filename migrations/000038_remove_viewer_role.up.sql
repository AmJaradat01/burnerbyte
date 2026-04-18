-- Remove viewer team role and its permission assignments from the roles system
BEGIN;

DELETE FROM role_permissions WHERE role_id IN (
    SELECT id FROM roles WHERE scope = 'team' AND value = 'viewer'
);

DELETE FROM roles WHERE scope = 'team' AND value = 'viewer';

COMMIT;
