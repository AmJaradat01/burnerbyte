ALTER TABLE sso_providers ADD COLUMN default_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
