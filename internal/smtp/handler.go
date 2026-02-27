package smtp

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
	redisrepo "gitlab.com/amjaradat01/burnerbyte/internal/repository/redis"
)

// InboundEmail represents a parsed inbound email.
type InboundEmail struct {
	MessageID   string
	From        string
	To          string
	Subject     string
	BodyText    string
	BodyHTML    string
	Headers     map[string]string
	SizeBytes   int64
	Attachments []InboundAttachment
	ReceivedAt  time.Time
}

type InboundAttachment struct {
	Filename    string
	ContentType string
	Data        []byte
}

// Handler processes inbound emails and stores them.
type Handler struct {
	inboxRepoPG    *postgres.InboxRepo
	inboxRepoRedis *redisrepo.InboxRepo
	emailRepo      *postgres.EmailRepo
}

func NewHandler(
	inboxRepoPG *postgres.InboxRepo,
	inboxRepoRedis *redisrepo.InboxRepo,
	emailRepo *postgres.EmailRepo,
) *Handler {
	return &Handler{
		inboxRepoPG:    inboxRepoPG,
		inboxRepoRedis: inboxRepoRedis,
		emailRepo:      emailRepo,
	}
}

// Process stores an inbound email. Called by worker goroutines.
func (h *Handler) Process(ctx context.Context, email *InboundEmail) error {
	toAddr := strings.ToLower(strings.TrimSpace(email.To))

	// Fast lookup in Redis
	inboxID, err := h.inboxRepoRedis.Get(ctx, toAddr)
	if err != nil {
		slog.Error("redis inbox lookup failed, falling back to PG", "error", err)
	}

	var inbox *domain.Inbox
	if inboxID != "" {
		id, _ := uuid.Parse(inboxID)
		inbox, err = h.inboxRepoPG.GetByID(ctx, id)
		if err != nil {
			return fmt.Errorf("inbox lookup by ID: %w", err)
		}
	} else {
		// Fallback to PG
		inbox, err = h.inboxRepoPG.GetByFullAddress(ctx, toAddr)
		if err != nil {
			return fmt.Errorf("inbox not found for %s", toAddr)
		}
		// Re-populate Redis
		remaining := time.Until(inbox.ExpiresAt)
		if remaining > 0 {
			_ = h.inboxRepoRedis.Set(ctx, toAddr, inbox.ID.String(), remaining)
		}
	}

	if !inbox.IsActive || time.Now().After(inbox.ExpiresAt) {
		return fmt.Errorf("inbox expired or inactive: %s", toAddr)
	}

	// Store email
	e := &domain.Email{
		ID:             uuid.New(),
		InboxID:        inbox.ID,
		MessageID:      nilIfEmpty(email.MessageID),
		FromAddress:    email.From,
		ToAddress:      email.To,
		Subject:        &email.Subject,
		BodyText:       &email.BodyText,
		BodyHTML:       &email.BodyHTML,
		HasAttachments: len(email.Attachments) > 0,
		SizeBytes:      email.SizeBytes,
		ReceivedAt:     email.ReceivedAt,
		ExpiresAt:      inbox.ExpiresAt,
	}

	if err := h.emailRepo.Create(ctx, e); err != nil {
		return fmt.Errorf("store email: %w", err)
	}

	slog.Info("email stored", "email_id", e.ID, "inbox", toAddr, "from", email.From)
	return nil
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
