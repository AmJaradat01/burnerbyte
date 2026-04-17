-- Revert enhanced domains

DROP TABLE IF EXISTS domain_verification_history;
DROP INDEX IF EXISTS idx_domains_name_trgm;
ALTER TABLE domains DROP COLUMN IF EXISTS spf_verified;
ALTER TABLE domains DROP COLUMN IF EXISTS description;
