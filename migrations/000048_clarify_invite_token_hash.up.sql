-- invites.token has always stored a SHA-256 hex digest, not the token: both
-- the insert and the lookup in OrgRepo wrap the value in HashToken. The name
-- said otherwise, and a security review read the schema and reported
-- plaintext invite storage on the strength of it. Rename to match the
-- neighbouring password_reset_tokens.token_hash and
-- email_verification_tokens.token_hash so the schema stops lying.
ALTER TABLE invites RENAME COLUMN token TO token_hash;
