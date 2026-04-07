ALTER TABLE notifications ADD COLUMN inbox_id UUID REFERENCES inboxes(id) ON DELETE CASCADE;
CREATE INDEX idx_notifications_inbox ON notifications(inbox_id);
