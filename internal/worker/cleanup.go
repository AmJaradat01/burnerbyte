package worker

import (
	"context"
	"log/slog"

	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

// AttachmentCleaner deletes attachments for an email.
type AttachmentCleaner interface {
	DeleteByEmail(ctx context.Context, emailID uuid.UUID) error
}

func CleanupJob(inboxRepo *postgres.InboxRepo, emailRepo *postgres.EmailRepo, attachmentCleaner AttachmentCleaner, sessionRepo *postgres.SessionRepo, resetRepo *postgres.PasswordResetRepo) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		// Delete expired emails and collect IDs for attachment cleanup
		emailIDs, err := emailRepo.DeleteExpiredReturningIDs(ctx)
		if err != nil {
			// Fallback to simple delete if the new method doesn't exist
			emails, err2 := emailRepo.DeleteExpired(ctx)
			if err2 != nil {
				return err2
			}
			if emails > 0 {
				slog.Info("cleanup: expired emails deleted", "count", emails)
			}
		} else if len(emailIDs) > 0 && attachmentCleaner != nil {
			for _, id := range emailIDs {
				if err := attachmentCleaner.DeleteByEmail(ctx, id); err != nil {
					slog.Error("cleanup: failed to delete attachments", "email_id", id, "error", err)
				}
			}
			slog.Info("cleanup: expired emails + attachments deleted", "count", len(emailIDs))
		}

		inboxes, err := inboxRepo.DeleteExpired(ctx)
		if err != nil {
			return err
		}
		if inboxes > 0 {
			slog.Info("cleanup: expired inboxes deleted", "count", inboxes)
		}

		// Clean expired sessions
		if sessionRepo != nil {
			if n, err := sessionRepo.DeleteExpired(ctx); err == nil && n > 0 {
				slog.Info("cleanup: expired sessions deleted", "count", n)
			}
		}

		// Clean expired password reset tokens
		if resetRepo != nil {
			if n, err := resetRepo.DeleteExpired(ctx); err == nil && n > 0 {
				slog.Info("cleanup: expired password resets deleted", "count", n)
			}
		}

		return nil
	}
}
