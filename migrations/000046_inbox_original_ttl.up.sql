-- Add original_ttl to inboxes so renewal can respect the duration the user chose.
-- Nullable TEXT storing a Go-duration string (e.g. "15m", "1h", "6h").
-- Existing rows get NULL which means "use system default on renewal" (backward-compatible).
ALTER TABLE inboxes ADD COLUMN IF NOT EXISTS original_ttl TEXT;
