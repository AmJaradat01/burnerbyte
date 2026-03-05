package worker

import (
	"context"
	"log/slog"

	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
	"gitlab.com/burnerbyte/burnerbyte/internal/webhook"
)

func WebhookRetryJob(webhookRepo *postgres.WebhookRepo, dispatcher *webhook.Dispatcher) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		webhooks, err := webhookRepo.ListFailedRetryable(ctx)
		if err != nil {
			return err
		}
		for _, wh := range webhooks {
			for _, event := range wh.Events {
				dispatcher.Dispatch(ctx, wh.TeamID, event, map[string]string{"retry": "true"})
			}
		}
		if len(webhooks) > 0 {
			slog.Info("webhook retry dispatched", "count", len(webhooks))
		}
		return nil
	}
}
