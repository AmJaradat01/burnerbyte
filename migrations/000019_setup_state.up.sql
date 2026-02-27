CREATE TABLE IF NOT EXISTS setup_state (
    id          BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id), -- singleton row
    completed   BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES users(id)
);

INSERT INTO setup_state (id, completed) VALUES (TRUE, FALSE) ON CONFLICT DO NOTHING;
