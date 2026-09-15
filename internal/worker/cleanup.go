package worker

import (
	"context"
	"log/slog"

	"github.com/google/uuid"

	"github.com/amjaradat01/burnerbyte/internal/domain"
	"github.com/amjaradat01/burnerbyte/internal/realtime"
	"github.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

// AttachmentCleaner deletes attachments for an email.
type AttachmentCleaner interface {
	DeleteByEmail(ctx context.Context, emailID uuid.UUID) error
}

// WebhookDispatcher dispatches a webhook event to a team's subscribers.
type WebhookDispatcher interface {
	Dispatch(ctx context.Context, teamID uuid.UUID, event string, data any)
}

// ExpiryAuditRecorder records a system-initiated audit entry (nil actor).
type ExpiryAuditRecorder interface {
	RecordWithName(ctx context.Context, orgID uuid.UUID, actorID *uuid.UUID, action, resourceType string, resourceID uuid.UUID, resourceName string, metadata any)
}

// InboxEventPublisher publishes a realtime inbox event. Going through the
// realtime bridge drives both the live notification push and the persisted
// notification row, the same way email.received does.
type InboxEventPublisher interface {
	PublishInboxEvent(ctx context.Context, inboxID, userID, orgID uuid.UUID, sizeBytes int64, senderDomain, domainName string, teamID uuid.UUID, hour int, msg realtime.Message)
}

func CleanupJob(inboxRepo *postgres.InboxRepo, emailRepo *postgres.EmailRepo, attachmentCleaner AttachmentCleaner, sessionRepo *postgres.SessionRepo, resetRepo *postgres.PasswordResetRepo, apikeyRepo *postgres.APIKeyRepo, dispatcher WebhookDispatcher, auditRec ExpiryAuditRecorder, publisher InboxEventPublisher) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		// Delete expired emails and collect IDs for attachment cleanup
		emailIDs, err := emailRepo.DeleteExpiredReturningIDs(ctx)
		if err != nil {
			// Fallback to simple delete
			emails, err2 := emailRepo.DeleteExpired(ctx)
			if err2 != nil {
				slog.Error("cleanup: failed to delete expired emails", "error", err2)
			} else if emails > 0 {
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

		// Emit inbox.expired before removing the rows, so webhook subscribers
		// and the audit log observe the lifecycle event. Without this the
		// inbox.expired event is registered but never dispatched.
		if expired, err := inboxRepo.ListExpired(ctx); err != nil {
			slog.Error("cleanup: failed to list expired inboxes", "error", err)
		} else {
			emitInboxExpired(ctx, expired, dispatcher, auditRec, publisher)
			if len(expired) > 0 {
				slog.Info("cleanup: inbox.expired emitted", "count", len(expired))
			}
		}

		inboxes, err := inboxRepo.DeleteExpired(ctx)
		if err != nil {
			slog.Error("cleanup: failed to delete expired inboxes", "error", err)
		} else if inboxes > 0 {
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

		// Clean expired API keys
		if apikeyRepo != nil {
			if n, err := apikeyRepo.DeleteExpiredKeys(ctx); err == nil && n > 0 {
				slog.Info("cleanup: expired API keys deleted", "count", n)
			} else if err != nil {
				slog.Error("cleanup: failed to delete expired API keys", "error", err)
			}
		}

		return nil
	}
}

// emitInboxExpired announces inbox expiry on every channel: a webhook to the
// owning team (only when the team is known), a system-initiated audit entry,
// and a realtime event that drives the notification bell. Kept separate from
// CleanupJob so the dispatch logic is testable without a database.
func emitInboxExpired(ctx context.Context, expired []domain.Inbox, dispatcher WebhookDispatcher, auditRec ExpiryAuditRecorder, publisher InboxEventPublisher) {
	for _, ib := range expired {
		if dispatcher != nil && ib.TeamID != uuid.Nil {
			dispatcher.Dispatch(ctx, ib.TeamID, "inbox.expired", map[string]any{
				"inbox_id": ib.ID, "address": ib.FullAddress, "expired_at": ib.ExpiresAt,
			})
		}
		if auditRec != nil {
			auditRec.RecordWithName(ctx, ib.OrgID, nil, "inbox.expired", "inbox", ib.ID, ib.FullAddress, map[string]any{
				"address": ib.FullAddress, "expired_at": ib.ExpiresAt,
			})
		}
		if publisher != nil {
			publisher.PublishInboxEvent(ctx, ib.ID, ib.CreatedBy, ib.OrgID, 0, "", "", ib.TeamID, -1, realtime.Message{
				Type: "inbox.expired",
				Data: map[string]any{"full_address": ib.FullAddress, "inbox_id": ib.ID},
			})
		}
	}
}
