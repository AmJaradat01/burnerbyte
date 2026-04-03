-- Dynamic roles and permissions
CREATE TABLE roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope       VARCHAR(10) NOT NULL CHECK (scope IN ('org', 'team')),
    value       VARCHAR(50) NOT NULL,
    label       VARCHAR(100) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    rank        INT NOT NULL DEFAULT 1,
    is_system   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(scope, value)
);

CREATE TABLE permissions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope       VARCHAR(10) NOT NULL CHECK (scope IN ('org', 'team')),
    key         VARCHAR(100) NOT NULL UNIQUE,
    label       VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE role_permissions (
    role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- Seed org roles
INSERT INTO roles (scope, value, label, description, rank, is_system) VALUES
    ('org', 'owner', 'Owner', 'Full control over the organization', 3, TRUE),
    ('org', 'admin', 'Admin', 'Manage settings, members, and resources', 2, TRUE),
    ('org', 'member', 'Member', 'Standard access to assigned resources', 1, TRUE);

-- Seed team roles
INSERT INTO roles (scope, value, label, description, rank, is_system) VALUES
    ('team', 'lead', 'Lead', 'Manage team settings, webhooks, API keys, and members', 2, TRUE),
    ('team', 'member', 'Member', 'Create inboxes, view emails, use team domains', 1, TRUE);

-- Seed org permissions
INSERT INTO permissions (scope, key, label, description) VALUES
    ('org', 'org.settings.manage', 'Manage organization settings', 'Edit org name, logo, policies, and quotas'),
    ('org', 'org.delete', 'Delete organization', 'Permanently delete the organization'),
    ('org', 'org.members.invite', 'Invite members', 'Send invitations to join the organization'),
    ('org', 'org.members.remove', 'Remove members', 'Remove members from the organization'),
    ('org', 'org.members.role', 'Change member roles', 'Promote or demote organization members'),
    ('org', 'org.domains.manage', 'Manage domains', 'Add, verify, and remove domains'),
    ('org', 'org.teams.manage', 'Create and manage teams', 'Create, edit, and delete teams'),
    ('org', 'org.audit.view', 'View audit logs', 'Access the organization audit trail'),
    ('org', 'org.view', 'View organization', 'Basic read access to the organization');

-- Seed team permissions
INSERT INTO permissions (scope, key, label, description) VALUES
    ('team', 'team.settings.manage', 'Manage team settings', 'Edit team name and configuration'),
    ('team', 'team.members.manage', 'Manage team members', 'Add and remove team members'),
    ('team', 'team.webhooks.manage', 'Manage webhooks', 'Create, edit, and delete webhooks'),
    ('team', 'team.apikeys.manage', 'Manage API keys', 'Create and revoke API keys'),
    ('team', 'team.domains.manage', 'Manage domain assignments', 'Assign and unassign domains'),
    ('team', 'team.inboxes.manage', 'Manage inboxes', 'Create and manage temporary inboxes'),
    ('team', 'team.emails.view', 'View emails', 'Read emails received by team inboxes');

-- Assign permissions to org roles
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.scope = 'org' AND p.scope = 'org' AND r.value = 'owner';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.scope = 'org' AND p.scope = 'org' AND r.value = 'admin'
  AND p.key IN ('org.settings.manage', 'org.members.invite', 'org.members.remove', 'org.domains.manage', 'org.teams.manage', 'org.audit.view', 'org.view');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.scope = 'org' AND p.scope = 'org' AND r.value = 'member'
  AND p.key = 'org.view';

-- Assign permissions to team roles
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.scope = 'team' AND p.scope = 'team' AND r.value = 'lead';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.scope = 'team' AND p.scope = 'team' AND r.value = 'member'
  AND p.key IN ('team.inboxes.manage', 'team.emails.view');
