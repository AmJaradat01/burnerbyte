CREATE TABLE webhook_delivery_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id      UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event           VARCHAR(50) NOT NULL,
    payload         JSONB NOT NULL,
    response_status INT,
    response_body   TEXT,
    response_time_ms INT,
    success         BOOLEAN NOT NULL,
    attempt         INT NOT NULL DEFAULT 1,
    idempotency_key VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_delivery_logs_webhook ON webhook_delivery_logs(webhook_id);
CREATE INDEX idx_webhook_delivery_logs_created ON webhook_delivery_logs(created_at);
CREATE INDEX idx_webhook_delivery_logs_idempotency ON webhook_delivery_logs(idempotency_key);
