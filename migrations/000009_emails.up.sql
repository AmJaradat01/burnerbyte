CREATE TABLE emails (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inbox_id        UUID NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    message_id      VARCHAR(995),
    from_address    VARCHAR(320) NOT NULL,
    to_address      VARCHAR(320) NOT NULL,
    subject         TEXT,
    body_text       TEXT,
    body_html       TEXT,
    has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
    raw_headers     JSONB,
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    spam_score      REAL NOT NULL DEFAULT 0.0,
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    search_vector   TSVECTOR
);

CREATE INDEX idx_emails_inbox ON emails(inbox_id);
CREATE INDEX idx_emails_inbox_received ON emails(inbox_id, received_at DESC);
CREATE INDEX idx_emails_received ON emails(received_at);
CREATE INDEX idx_emails_expires ON emails(expires_at);
CREATE INDEX idx_emails_message_id ON emails(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX idx_emails_search ON emails USING GIN(search_vector);
CREATE INDEX idx_emails_unread ON emails(inbox_id, is_read) WHERE is_read = FALSE;
