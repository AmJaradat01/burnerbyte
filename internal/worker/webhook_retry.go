package worker

import (
	"context"
	"log/slog"

	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
	"gitlab.com/amjaradat01/burnerbyte/internal/webhook"
)

// WebhookRetryJob resets failure counts on retryable webhooks so the
// dispatcher will attempt delivery again on the next real event.
// We don't re-dispatch synthetic events — that would send bogus payloads
// to consumers. Instead, resetting failure_count re-enables the webhook
// for the next genuine event.
func WebhookRetryJob(webhookRepo *postgres.WebhookRepo, dispatcher *webhook.Dispatcher) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		webhooks, err := webhookRepo.ListFailedRetryable(ctx)
		if err != nil {
			return err
		}
		for _, wh := range webhooks {
			if err := webhookRepo.ResetFailureCount(ctx, wh.ID); err != nil {
				slog.Error("webhook retry: failed to reset failure count", "webhook_id", wh.ID, "error", err)
				continue
			}
		}
		if len(webhooks) > 0 {
			slog.Info("webhook retry: reset failure counts", "count", len(webhooks))
		}
		return nil
	}
}
