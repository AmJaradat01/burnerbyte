package worker

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"gitlab.com/burnerbyte/burnerbyte/internal/mailer"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

// InviteExpiryJob returns a worker function that finds invites expiring within
// 24 hours and sends reminder emails to the inviters.
func InviteExpiryJob(orgRepo *postgres.OrgRepo, userRepo *postgres.UserRepo, ml *mailer.Mailer, baseURL string) func(ctx context.Context) error {
	return func(ctx context.Context) error {
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
			slog.Info("invite expiry worker completed", "expiring", len(invites), "emails_sent", sent)
		}
		return nil
	}
}
