CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_delivery_logs_idempotency_key_unique
ON webhook_delivery_logs (idempotency_key) WHERE idempotency_key IS NOT NULL;
