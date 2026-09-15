-- internal/handler/email.go gates mark-all-read, mark read/unread and delete-email
-- on the scope "team.emails.manage", but that permission was never seeded. API key
-- scopes are validated against this table, so no key could hold it and those three
-- endpoints answered 403 for every API-key caller. Session auth was unaffected —
-- the scope guard only fires when the request carries API key scopes.
--
-- Seeded as a distinct permission rather than folding the writes into
-- team.emails.view: deleting an email is not a read, and a key scoped to view
-- should not be able to destroy mail.
BEGIN;

INSERT INTO permissions (scope, key, label, description) VALUES
    ('team', 'team.emails.manage', 'Manage emails',
     'Mark emails read or unread and delete emails from team inboxes')
ON CONFLICT DO NOTHING;

-- Lead holds every team permission (migration 000037, section 6).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.scope = 'team' AND r.value = 'lead'
  AND p.scope = 'team' AND p.key = 'team.emails.manage'
ON CONFLICT DO NOTHING;

-- Member already holds team.inboxes.manage and team.emails.view, and inboxes are
-- readable only by their creator, so managing mail in one's own inbox is in scope.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.scope = 'team' AND r.value = 'member'
  AND p.scope = 'team' AND p.key = 'team.emails.manage'
ON CONFLICT DO NOTHING;

COMMIT;
