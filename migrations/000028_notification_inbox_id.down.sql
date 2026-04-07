DROP INDEX IF EXISTS idx_notifications_inbox;
ALTER TABLE notifications DROP COLUMN IF EXISTS inbox_id;
