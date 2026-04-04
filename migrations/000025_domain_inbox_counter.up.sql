ALTER TABLE domains ADD COLUMN inboxes_created_count INTEGER NOT NULL DEFAULT 0;

-- Backfill: count existing inboxes (active ones still in the table)
UPDATE domains d SET inboxes_created_count = (
  SELECT COUNT(*) FROM inboxes i WHERE i.domain_id = d.id
);
