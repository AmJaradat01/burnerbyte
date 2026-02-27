package worker

import (
	"context"
	"log/slog"

	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

func CleanupJob(inboxRepo *postgres.InboxRepo, emailRepo *postgres.EmailRepo) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		inboxes, err := inboxRepo.DeleteExpired(ctx)
		if err != nil { return err }
		emails, err := emailRepo.DeleteExpired(ctx)
		if err != nil { return err }
		if inboxes > 0 || emails > 0 {
			slog.Info("cleanup completed", "expired_inboxes", inboxes, "expired_emails", emails)
		}
		return nil
	}
}
