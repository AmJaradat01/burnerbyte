package smtp

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/realtime"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
	redisrepo "gitlab.com/burnerbyte/burnerbyte/internal/repository/redis"
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
	notifHub          NotifHub
	publisher         *realtime.Publisher
	attachmentStorer  AttachmentStorer
	settingsChecker   SettingsChecker
	auditRecorder     AuditRecorder
}

// AuditRecorder records audit events for email delivery.
type AuditRecorder interface {
	RecordWithName(ctx context.Context, orgID uuid.UUID, actorID *uuid.UUID, action, resourceType string, resourceID uuid.UUID, resourceName string, metadata any)
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

// NotifHub pushes user-level notifications.
type NotifHub interface {
	Notify(userID uuid.UUID, msg realtime.Message)
}

func NewHandler(
	inboxRepoPG *postgres.InboxRepo,
	inboxRepoRedis *redisrepo.InboxRepo,
	emailRepo *postgres.EmailRepo,
	assignmentRepo *postgres.DomainAssignmentRepo,
	webhookDispatcher WebhookDispatcher,
	hub RealtimeHub,
	notifHub NotifHub,
	attachmentStorer AttachmentStorer,
	settingsChecker SettingsChecker,
	publisher *realtime.Publisher,
	auditRecorder AuditRecorder,
) *Handler {
	return &Handler{
		inboxRepoPG:       inboxRepoPG,
		inboxRepoRedis:    inboxRepoRedis,
		emailRepo:         emailRepo,
		assignmentRepo:    assignmentRepo,
		webhookDispatcher: webhookDispatcher,
		hub:               hub,
		notifHub:          notifHub,
		publisher:         publisher,
		attachmentStorer:  attachmentStorer,
		settingsChecker:   settingsChecker,
		auditRecorder:     auditRecorder,
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
		id, err := uuid.Parse(inboxID)
		if err != nil {
			slog.Warn("corrupt inbox ID in redis, falling back to PG lookup", "raw", inboxID)
			inboxID = "" // Force PG fallback
		} else {
			inbox, err = h.inboxRepoPG.GetByID(ctx, id)
			if err != nil {
				return fmt.Errorf("inbox lookup by ID: %w", err)
			}
		}
	}
	if inboxID == "" {
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
		HasAttachments: false,
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
	var storedCount int
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
				} else {
					storedCount++
				}
			}
		}
	}

	// Update HasAttachments only if attachments were actually stored
	if storedCount > 0 {
		if err := h.emailRepo.SetHasAttachments(ctx, e.ID, true); err != nil {
			slog.Error("failed to update has_attachments flag", "error", err)
		}
	}

	// Look up domain assignment for analytics metadata and webhook dispatch
	var teamID uuid.UUID
	var domainName string
	if h.assignmentRepo != nil {
		assignment, err := h.assignmentRepo.GetByID(ctx, inbox.DomainAssignmentID)
		if err == nil {
			teamID = assignment.TeamID
			domainName = assignment.DomainName
		}
	}

	// Extract sender domain from From address
	var senderDomain string
	if parts := strings.SplitN(email.From, "@", 2); len(parts) == 2 {
		senderDomain = strings.ToLower(parts[1])
	}

	// Dispatch webhook event
	if h.webhookDispatcher != nil && teamID != uuid.Nil {
		h.webhookDispatcher.Dispatch(ctx, teamID, "email.received", map[string]any{
			"email_id": e.ID, "inbox_id": inbox.ID, "from": email.From, "subject": email.Subject,
		})
	}

	// Record audit event with inbox address as resource_name for searchability
	if h.auditRecorder != nil {
		h.auditRecorder.RecordWithName(ctx, inbox.OrgID, &inbox.CreatedBy, "email.received", "email", e.ID, inbox.FullAddress, map[string]any{
			"from": email.From, "subject": email.Subject, "inbox_id": inbox.ID.String(), "inbox_address": inbox.FullAddress,
		})
	}

	// Broadcast to WebSocket
	if h.publisher != nil {
		h.publisher.PublishInboxEvent(ctx, inbox.ID, inbox.CreatedBy, inbox.OrgID, e.SizeBytes,
			senderDomain, domainName, teamID, email.ReceivedAt.Hour(),
			realtime.Message{
				Type: "email.received",
				Data: e,
			})
	} else {
		if h.hub != nil {
			h.hub.Broadcast(inbox.ID, realtime.Message{
				Type: "email.received",
				Data: e,
			})
		}
		if h.notifHub != nil {
			h.notifHub.Notify(inbox.CreatedBy, realtime.Message{
				Type: "email.received",
				Data: map[string]any{
					"inbox_id": inbox.ID, "email_id": e.ID,
					"from": email.From, "subject": email.Subject,
				},
			})
		}
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
