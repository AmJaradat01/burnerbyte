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
	inboxRepoPG       *postgres.InboxRepo
	inboxRepoRedis    *redisrepo.InboxRepo
	emailRepo         *postgres.EmailRepo
	assignmentRepo    *postgres.DomainAssignmentRepo
	webhookDispatcher WebhookDispatcher
	hub               RealtimeHub
	attachmentStorer  AttachmentStorer
	settingsChecker   SettingsChecker
}

// WebhookDispatcher dispatches webhook events.
type WebhookDispatcher interface {
	Dispatch(ctx context.Context, teamID uuid.UUID, event string, data any)
}

// RealtimeHub broadcasts messages to WebSocket clients.
type RealtimeHub interface {
	Broadcast(inboxID uuid.UUID, msg interface{})
}

// AttachmentStorer stores email attachments.
type AttachmentStorer interface {
	StoreAttachment(ctx context.Context, emailID uuid.UUID, filename, contentType string, data []byte) (*domain.Attachment, error)
}

// SettingsChecker resolves settings from the cascade.
type SettingsChecker interface {
	ResolveAttachmentsEnabled(ctx context.Context, assignmentID uuid.UUID) (bool, error)
	ResolveMaxAttachmentSize(ctx context.Context, assignmentID uuid.UUID) int
}

func NewHandler(
	inboxRepoPG *postgres.InboxRepo,
	inboxRepoRedis *redisrepo.InboxRepo,
	emailRepo *postgres.EmailRepo,
	assignmentRepo *postgres.DomainAssignmentRepo,
	webhookDispatcher WebhookDispatcher,
	hub RealtimeHub,
	attachmentStorer AttachmentStorer,
	settingsChecker SettingsChecker,
) *Handler {
	return &Handler{
		inboxRepoPG:       inboxRepoPG,
		inboxRepoRedis:    inboxRepoRedis,
		emailRepo:         emailRepo,
		assignmentRepo:    assignmentRepo,
		webhookDispatcher: webhookDispatcher,
		hub:               hub,
		attachmentStorer:  attachmentStorer,
		settingsChecker:   settingsChecker,
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

	// Basic spam scoring
	spamScore := calcSpamScore(email)

	// Store email
	e := &domain.Email{
		ID:             uuid.New(),
		InboxID:        inbox.ID,
		MessageID:      nilIfEmpty(email.MessageID),
		FromAddress:    email.From,
		ToAddress:      email.To,
		Subject:        &email.Subject,
		BodyText:       &email.BodyText,
		BodyHTML:        &email.BodyHTML,
		HasAttachments: len(email.Attachments) > 0,
		RawHeaders:     email.Headers,
		SizeBytes:      email.SizeBytes,
		SpamScore:      spamScore,
		ReceivedAt:     email.ReceivedAt,
		ExpiresAt:      inbox.ExpiresAt,
	}

	if err := h.emailRepo.Create(ctx, e); err != nil {
		return fmt.Errorf("store email: %w", err)
	}

	// Store attachments if enabled by settings cascade
	if len(email.Attachments) > 0 && h.attachmentStorer != nil && h.settingsChecker != nil {
		enabled, _ := h.settingsChecker.ResolveAttachmentsEnabled(ctx, inbox.DomainAssignmentID)
		if enabled {
			maxSize := h.settingsChecker.ResolveMaxAttachmentSize(ctx, inbox.DomainAssignmentID)
			for _, att := range email.Attachments {
				if len(att.Data) > maxSize {
					slog.Warn("attachment exceeds max size, skipping", "filename", att.Filename, "size", len(att.Data), "max", maxSize)
					continue
				}
				if _, err := h.attachmentStorer.StoreAttachment(ctx, e.ID, att.Filename, att.ContentType, att.Data); err != nil {
					slog.Error("failed to store attachment", "filename", att.Filename, "error", err)
				}
			}
		}
	}

	// Dispatch webhook event
	if h.webhookDispatcher != nil && h.assignmentRepo != nil {
		assignment, err := h.assignmentRepo.GetByID(ctx, inbox.DomainAssignmentID)
		if err == nil {
			h.webhookDispatcher.Dispatch(ctx, assignment.TeamID, "email.received", map[string]any{
				"email_id": e.ID, "inbox_id": inbox.ID, "from": email.From, "subject": email.Subject,
			})
		}
	}

	// Broadcast to WebSocket
	if h.hub != nil {
		h.hub.Broadcast(inbox.ID, e)
	}

	slog.Info("email stored", "email_id", e.ID, "inbox", toAddr, "from", email.From)
	return nil
}

// calcSpamScore returns a basic spam score (0.0 = clean, higher = spammier).
// Checks: missing headers, SPF result, suspicious patterns.
func calcSpamScore(email *InboundEmail) float32 {
	var score float32

	// Missing Message-ID
	if email.MessageID == "" {
		score += 1.0
	}
	// Missing or empty subject
	if strings.TrimSpace(email.Subject) == "" {
		score += 0.5
	}
	// SPF fail from headers
	spf := strings.ToLower(email.Headers["Received-SPF"])
	if strings.Contains(spf, "fail") {
		score += 2.0
	} else if spf == "" {
		score += 0.5
	}
	// Missing Date header
	if email.Headers["Date"] == "" {
		score += 0.5
	}
	// Missing From header (different from envelope)
	if email.Headers["From"] == "" {
		score += 1.0
	}

	if score > 10.0 {
		score = 10.0
	}
	return score
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
