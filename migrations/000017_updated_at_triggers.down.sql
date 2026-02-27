DROP TRIGGER IF EXISTS trg_webhooks_updated_at ON webhooks;
DROP TRIGGER IF EXISTS trg_domain_assignments_updated_at ON domain_assignments;
DROP TRIGGER IF EXISTS trg_domains_updated_at ON domains;
DROP TRIGGER IF EXISTS trg_teams_updated_at ON teams;
DROP TRIGGER IF EXISTS trg_organizations_updated_at ON organizations;
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
DROP FUNCTION IF EXISTS update_updated_at();
