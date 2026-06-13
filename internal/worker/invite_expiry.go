package worker

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

// emailSender is the subset of *mailer.Mailer that the expiry worker depends
// on. Accepting an interface (rather than the concrete mailer) lets tests
// substitute a fake and exercise the send-failure path. *mailer.Mailer
// satisfies this interface, so production wiring is unchanged.
type emailSender interface {
	Send(to, subject, templateName string, data any) error
}

// InviteExpiryJob returns a worker function that finds invites expiring within
// 24 hours and sends reminder emails to the inviters, then cleans up already-expired invites.
func InviteExpiryJob(orgRepo *postgres.OrgRepo, userRepo *postgres.UserRepo, ml emailSender, baseURL string) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		// Phase 1: Send reminders for invites expiring soon
		invites, err := orgRepo.FindExpiringInvites(ctx, 24*time.Hour)
		if err != nil {
			return fmt.Errorf("query expiring invites: %w", err)
		}

		sent := 0
		for _, invite := range invites {
			if invite.InvitedBy == nil {
				continue // no inviter to notify
			}

			inviter, err := userRepo.GetByID(ctx, *invite.InvitedBy)
			if err != nil {
				slog.Warn("expiry worker: inviter not found", "invited_by", invite.InvitedBy, "invite_id", invite.ID)
				continue
			}

			hoursLeft := int(time.Until(invite.ExpiresAt).Hours())
			if err := ml.Send(inviter.Email, "Invite expiring soon", "invite_expiry.html", map[string]string{
				"InviteeEmail": invite.Email,
				"HoursLeft":    fmt.Sprintf("%d", hoursLeft),
				"InviteURL":    fmt.Sprintf("%s/settings?tab=users", baseURL),
			}); err != nil {
				slog.Error("expiry worker: failed to send email", "inviter", inviter.Email, "error", err)
				continue
			}
			sent++
		}

		if len(invites) > 0 {
			slog.Info("invite expiry worker: reminders sent", "expiring", len(invites), "emails_sent", sent)
		}

		// Phase 2: Clean up already-expired invites
		deleted, err := orgRepo.DeleteExpiredInvites(ctx)
		if err != nil {
			slog.Error("expiry worker: failed to delete expired invites", "error", err)
		} else if deleted > 0 {
			slog.Info("invite expiry worker: cleaned up expired invites", "deleted", deleted)
		}

		return nil
	}
}
